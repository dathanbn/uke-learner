# Audio engine: chord verification

This is the riskiest part of the product and the part that decides whether it feels
magic or broken. Build it first, in isolation, before any UI.

## The key reframe: verification, not identification

General chord recognition asks *"what chord is this?"* That is a hard, and on ukulele a
**formally unanswerable**, question. Ukulele standard tuning is reentrant (high G):

```
G4 = 392.0 Hz    C4 = 261.6 Hz    E4 = 329.6 Hz    A4 = 440.0 Hz
```

All four open strings live inside a single octave, and the highest-pitched string is not
the last one. There is no bass note, so there is no root to anchor on, and voicing order
carries no information. The consequence is that distinct chord names map to identical
audio:

| Shape | Notes | Equally correct names |
| --- | --- | --- |
| `0000` | G C E A | C6, Am7 |
| `0202` | G D E B | Em7, G6 |
| `2213` | A D F C | Dm7, F6 |

No amount of DSP fixes this, because the ambiguity is in music theory, not in the signal.

The reverse also holds: one chord *name* has many shapes. C major is `0003` (G C E C) and
also `0433` (G E G C) — different note sets, same name. A card teaches a specific shape, so
the scorer targets that shape's exact notes; an alternate voicing is a miss. See
`docs/DECISIONS.md` #4.

**We do not have this problem, because we already know what we asked for.** The card says
"play F". The only question is: *does this audio match F better than it matches the
handful of things a learner actually plays when they mean F?* That is a scoring problem
against a known target plus a small confusion set — dramatically easier and dramatically
more robust than open-set recognition.

Every design decision below follows from this reframe.

## Signal path

```
getUserMedia ─► AudioContext ─► AudioWorkletNode ─► ring buffer
                                       │
                                       ├─► onset detector (spectral flux)
                                       └─► on onset: analysis window ─► note activation
                                                                            │
                                                                    verdict scorer
```

- Sample rate: whatever the device gives (44.1k or 48k). Do not resample; compute bin
  frequencies from `audioContext.sampleRate`.
- Frame: 4096 samples (~93 ms at 44.1k), Hann window, hop 1024 (~23 ms).
- Zero-pad to 8192 before FFT for finer bin spacing (~5.4 Hz), which matters because
  adjacent semitones near C4 are only ~15 Hz apart.

### Critical: disable browser voice processing

```js
navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
});
```

These default to `true` and are tuned for speech. Noise suppression eats sustained
harmonic content and AGC destroys the decay envelope. Leaving them on is the single most
common reason a browser tuner or chord detector "just doesn't work." Verify the applied
settings with `track.getSettings()` — some browsers silently ignore the constraint, and
the app should warn the user if so.

## Note activation over a restricted range

Do not compute a generic 12-bin chroma. Chroma throws away octave, and octave is exactly
what tells you *which string* is wrong. Instead, score every MIDI note the instrument can
physically produce:

- High-G reentrant: MIDI **60 (C4) to 88 (E6)** covers open strings through the 12th fret.
- That is 29 candidate notes, not 128. The restriction is free accuracy.

For each candidate note `n` with fundamental `f0(n)`:

```
score(n) = Σ_{h=1..H} w(h) · mag(nearest_bin(h · f0(n)))
```

with `H = 5` harmonics and `w(h) = 1/h` rolloff. Nylon strings have a weak fundamental
and strong 2nd/3rd partials, so a harmonic sum is much more stable than peak-picking the
fundamental. Take the magnitude as the max over a ±50-cent window around each harmonic to
tolerate intonation error on cheap instruments.

Ghosts are then removed by **greedy harmonic peeling**, not by a per-note penalty:

1. Score every candidate note against a working copy of the spectrum.
2. Take the strongest — but first apply the **octave-error guard** (below).
3. Record its score, and attenuate its modelled partials out of the working spectrum.
4. Repeat, up to 6 notes, stopping when a candidate falls far below the first.

Notes never claimed keep their *residual* score, scaled down. That residual is not a
detail — it is the entire mechanism that separates "C4 ringing" from "C4 and C5 ringing",
because C5's fundamental sits exactly on C4's second partial. Re-measuring claimed notes
against the original spectrum looks like an obvious robustness improvement and is not: it
was tried, and it produced a false accept on "the A string is muted" for a C chord, because
on the raw spectrum a lone C4's partials give C5 a strong score.

### Three things that are counter-intuitive here

**The octave error runs upward, not downward.** A nylon string's second partial is *louder
than its fundamental*, so the note an octave above a played note can outscore the note that
caused it. Peel it first and you also strip the real note's even partials, leaving it
looking absent. Before accepting a peak, check whether a harmonically related lower note
(−12, −19, −24 semitones) scores at least `subOctaveRatio` of it; if so, peel the lower one.

**Weighting the fundamental more heavily makes ghosts worse, not better.** The intuition is
that a ghost has no fundamental, so emphasising h=1 should suppress it. But the worst
ghosts are *octaves*, whose fundamental is the lower note's strongest partial. Measured on
the synthetic corpus, raising the rolloff exponent from 1.0 to 2.5 drove the worst ghost
from 0.75 to 1.00 while the weakest real note fell from 0.76 to 0.60.

**Attenuate multiplicatively; don't subtract a flat value.** Flat subtraction across a
partial's main lobe clips it to zero and destroys the excess energy that proves a second
note is present. A gain of `1 − modelled/observed` removes exactly the modelled share and
leaves the remainder. Estimate a note's amplitude scale from a *low percentile* of its
observed/modelled partial ratios rather than the median: the median is pulled up by
precisely the partials another note is sharing.

`scalePercentile` and `subtractSpreadBins` are effectively a single parameter — sweep them
together. On the synthetic corpus, (0.25, 2) gives 95.6 % true-accept where (0.25, 1) gives
71 % and (0.25, 3) gives 80 %.

## Scoring: cosine similarity, not means

Given a hypothesis's note set `T` and the activation `a`:

```
confidence(T) = Σ_{n∈T} a(n) / ( sqrt(|T|) · ‖a‖ )
```

This is cosine similarity against a binary template, and both denominators are load-bearing:

- `sqrt(|T|)` stops a **subset** winning. The obvious scorer — mean activation over `T`
  minus mean energy elsewhere — is broken in the direction that causes false accepts:
  dropping a note *raises* a mean if that note was below average, so "string 3 muted"
  outscores the full chord even when every string is ringing. This was a real bug, and it
  made every Tier 1 chord unverifiable.
- `‖a‖` stops a **superset** winning, which is the mirror flaw in plain sums: a hypothesis
  with a phantom extra note would otherwise score identically to one without it.

## Onset detection and the analysis window

Continuous per-frame classification is fragile: the previous chord is still ringing, and
the moment of the strum is mostly broadband pick noise. Instead:

1. Detect onsets with spectral flux (positive-difference sum across bins), with a moving
   median threshold and a ~120 ms refractory period so one strum is one onset.
2. On an onset, analyze the window **80–250 ms after** it. Early enough that the chord has
   not decayed, late enough that the pick transient is gone.
3. Average the note activations over 3–4 hops in that window and score once.

This also gives you free "did they actually play something" gating, so background noise
never produces a verdict.

## Scoring a verdict

Given target shape `T` (a set of 4 expected MIDI notes, with duplicates collapsed):

```
match   = Σ_{n ∈ T} activation(n) / |T|
leakage = Σ_{n ∉ T, n ∈ range} activation(n) / |range \ T|
confidence = match − λ · leakage
```

Compare `confidence(T)` against `confidence(C)` for each `C` in the confusion set. Accept
`T` only if it wins by a margin and clears an absolute floor. Otherwise, reject — and use
the winner to explain *why*.

**The confusion set is generated, not hand-written.** For target shape `T`, enumerate:

- each string moved ±1 and ±2 frets (finger on the wrong fret),
- each fretted string opened (finger not pressing down),
- each string muted entirely (finger blocking an adjacent string),
- the standard "shape shifted up/down one fret" error.

This is at most ~25 hypotheses per chord, computable at build time, and it turns a binary
right/wrong into a diagnosis.

## Per-string diagnosis — the feature nobody else has

Because you scored actual notes rather than pitch classes, you can say which string is
wrong and what happened to it:

> Third string should be **C** (open) — you're playing **C♯**. Lift your finger.

> Fourth string is **muted** — your index finger is probably leaning on it.

Competitors report right/wrong and let you guess. This is the pedagogical payload of the
whole app: a beginner who is told *which finger* is wrong fixes it in one attempt instead
of ten. Design the verdict type to carry this from day one:

```ts
type Verdict =
  | { kind: 'correct'; confidence: number; msFromOnset: number }
  | { kind: 'incorrect'; confidence: number; perString: StringDiagnosis[] }
  | { kind: 'unclear'; reason: 'too_quiet' | 'no_onset' | 'ambiguous' };
```

`unclear` is not a failure grade. Never grade a card on a signal you did not understand —
re-prompt instead. Grading someone "Again" because a truck drove past is how you lose users.

## Tuning check

The spec calls for a strum at session start. A strum works for a **coarse** check: find
the four strongest spectral peaks in ±100-cent windows around the four expected
fundamentals and report cent deviations.

But a strum is genuinely hard to analyse precisely, and the naive implementation is not
merely imprecise — it is *biased*. A coarse grid search that takes the maximum over three
FFT bins has a plateau roughly ±24 cents wide at G4, so the argmax lands wherever noise
puts it. That is fine for finding a string and useless for a tuner, where 12 cents is the
difference between "in tune" and "tune your G string". Refine each candidate with parabolic
interpolation on its actual partials, weighting higher partials more (they carry more cents
per bin), and reject a refinement that jumps more than ~40 cents from the coarse estimate —
that means a partial got captured by a neighbouring string.

**The search window is the other trap.** It must stay well under half the closest interval
between two open strings, which on high-G is G4→A4 at just 200 cents. A ±160 cent window
lets G4's search lock onto A4, and it fails exactly when the instrument is flat, because
the global shift walks every string toward its neighbour's window. ±90 cents works, and it
bounds how large an offset can be absorbed at all.

If any string still reads ambiguous, fall back to a **slow arpeggio** (one string at a
time). Monophonic pitch detection on an isolated string is accurate to a couple of cents;
polyphonic estimation on a strum is not close. Flow: strum → confident? proceed : arpeggio.

### What can and cannot be automatic

This is the distinction the whole calibration design turns on:

| | What it means | Treatment |
| --- | --- | --- |
| **Global offset** | The whole instrument sits N cents from A440 | **Absorb silently.** Every interval is still correct, so every chord is still correct — only our reference was wrong. Move `PitchReference` and let them play. |
| **Relative error** | The strings disagree with each other | **Never absorb.** The intervals themselves are wrong, so the chords genuinely sound wrong. Correcting it in software would grade someone correct for a chord that sounds bad and train their ear on it — and it eats detector margin, since a string 50 cents sharp leaves only 50 cents before it looks like the next fret. |

Two implementation details that matter more than they look:

- The global offset is the **median** of per-string deviations, never the mean. One badly
  out string must not drag the reference with it — which is exactly what a mean does, and
  it smears the blame across all four strings so the tuner names the wrong one.
- When the spread between strings is *very* large (>60 cents), don't report a string to
  tune — report that the reading isn't trustworthy. A real instrument is rarely that
  internally inconsistent, so it almost always means the search locked onto the wrong
  strings, and confidently naming a string would be confident nonsense.

### Drift during a session

Nylon goes flat measurably within one session, especially a fresh set. Interrupting a
hands-free drill every few minutes to retune would wreck the one thing the product is for,
so drift is tracked *passively*: every accepted strum contributes a free offset
observation to an EWMA, and the user is only interrupted once the running estimate has both
enough observations to be trusted and moved far enough to matter.

Support at minimum:
- **High-G reentrant** GCEA (default)
- **Low-G** GCEA with G3 — changes the entire expected-note table
- **Baritone** DGBE (later)

Make tuning a data structure, not a constant, from the first commit.

## Library choices

| Library | Use it for | Notes |
| --- | --- | --- |
| Hand-rolled FFT + harmonic peeling | **Primary path — built** | Small, fast, explainable, gives per-string diagnosis. Nothing off-the-shelf gives you the confusion-set scoring you need. |
| [`pitchy`](https://github.com/ianprime0509/pitchy) | Tuner (monophonic) | McLeod pitch method, tiny, accurate on single strings. |
| [`Meyda`](https://meyda.js.org/) | Feature plumbing, prototyping | Lightweight; chroma/RMS/spectral flux if you don't want to write them. |
| [`essentia.js`](https://mtg.github.io/essentia.js/) | Reference / offline eval | WASM port of Essentia; HPCP, onset, chord detection. Several MB — good as an oracle to compare against, heavy for the hot loop. |
| [`@spotify/basic-pitch`](https://github.com/spotify/basic-pitch) | Optional heavy verifier | Real polyphonic transcription, but ~120 ms model latency and a *non-causal* note-creation step. Not for the real-time loop. |

**Do not start with a neural network.** The restricted range, known target, and generated
confusion set make classical DSP sufficient here, and a hand-rolled scorer is debuggable
at 2am in a way a model is not.

## Latency budget

Onset → verdict on screen must land under ~300 ms to feel hands-free.

| Stage | Budget |
| --- | --- |
| Input latency (`AudioContext.baseLatency` + device) | 20–60 ms desktop, up to 150 ms mobile |
| Wait for analysis window | 80–250 ms after onset |
| FFT + scoring (29 notes × 5 harmonics × 4 hops) | < 5 ms |
| React render | < 16 ms |

The dominant term is the deliberate wait, which is fine. Do the DSP in the AudioWorklet
or a Worker, never on the main thread — a dropped frame during scoring is a missed strum.

## The evaluation harness — build this on day one

The difference between a chord detector that works and one that "works on my ukulele in my
living room" is a test corpus. Before tuning a single threshold:

```
test/fixtures/
  high-g/
    C_correct_01.wav        C_correct_02.wav
    C_wrong_ring-2nd-fret.wav
    C_wrong_muted-1st.wav
    F_correct_01.wav        ...
```

**Status: built, running on synthetic audio.** `test/synth.ts` models a plucked nylon
string (weak fundamental, strong 2nd/3rd partial, per-partial decay) and the harness runs
every Tier 1–3 chord under six playing conditions — normal, quiet, loud, noisy room, slow
strum, fast strum — against every near miss the confusion generator produces. Current
score: **97.8 % true-accept, 0 % false-accept** over 90 correct and 238 wrong takes.

Synthetic audio is a floor on difficulty, not a measure of field accuracy. It has no room
reverb, no fret buzz, no intonation error, no phone-mic response. The real corpus is still
the deliverable.

Record every chord in the starter deck: 2–3 correct takes, plus the 2–3 wrong versions a
beginner actually plays. Add takes from a second instrument, a second room, and a phone
mic. The harness already decodes and scores whatever is in `test/fixtures/`, with a hard
floor in CI:

- **≥ 95 %** true-accept on correct takes
- **≤ 2 %** false-accept on wrong takes (a false accept is far worse than a false
  reject — it teaches the wrong shape)

This harness is what lets you or Claude change a threshold with confidence instead of
guessing. It is the highest-leverage hour in the project — and it has already earned that,
twice: it caught the subset-scoring bug that made every chord unverifiable, and it caught a
"robustness improvement" that silently introduced a false accept.

**Beware of tuning to noise.** With only a few takes per chord the metric swings several
points on nothing but a different random seed — enough to make a parameter sweep pick a
meaningless winner. That happened here: a sweep reported 95.6 % for a setting that measured
88.9 % on a different seed sequence. Six playing conditions per chord is what made the
number stable enough to tune against. Check that a repeated run reproduces before trusting
a sweep.

## Known hard cases

- **Ring-through.** The previous chord decays for seconds. Require a fresh onset and a
  rising energy envelope before scoring, and consider a "damp the strings" beat between
  cards for the first few sessions.
- **Buzzing / partially fretted strings.** Sound almost right, score almost right. These
  should read `unclear`, not `correct`.
- **Bluetooth mics (AirPods).** Mono, heavily processed, high latency. Detect the input
  device label and warn; recommend the built-in mic.
- **Room reverb and hard surfaces.** Smearing raises leakage; the adaptive threshold
  handles most of it, but a sensitivity slider is a necessary escape hatch.
- **The app cannot see fingering.** A chord fretted with the "wrong" fingers is acoustically
  identical to the right one. The app teaches the *sound*; the diagram teaches the hand.
  Accept this and say so in the UI rather than pretending otherwise.
