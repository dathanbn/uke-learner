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

Then suppress octave/harmonic ghosts: if `score(n)` is largely explained by `score(n-12)`
already being high, subtract its contribution. Without this, the 3rd partial of C4 will
light up G5 and you will "detect" notes nobody played.

Normalize the resulting activation vector, then threshold relative to the frame's own
peak (adaptive), never against an absolute level — playing volume varies enormously.

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

But a strum is genuinely hard to analyze precisely — four simultaneous notes inside one
octave, with overlapping partials. If any string reads ambiguous, fall back to asking for
a **slow arpeggio** (one string at a time). Monophonic pitch detection (YIN / McLeod, via
`pitchy`) on an isolated string is accurate to a couple of cents; polyphonic estimation on
a strum is not close. Design the flow as: strum → confident? proceed : arpeggio.

Support at minimum:
- **High-G reentrant** GCEA (default)
- **Low-G** GCEA with G3 — changes the entire expected-note table
- **Baritone** DGBE (later)

Make tuning a data structure, not a constant, from the first commit.

## Library choices

| Library | Use it for | Notes |
| --- | --- | --- |
| Hand-rolled FFT + harmonic scoring | **Primary path** | Small, fast, explainable, gives per-string diagnosis. Nothing off-the-shelf gives you the confusion-set scoring you need. |
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

Record every chord in the starter deck: 2–3 correct takes, plus the 2–3 wrong versions a
beginner actually plays. Add takes from a second instrument, a second room, and a phone
mic. Then a Node test that runs the detector over every fixture and reports a confusion
matrix, with a hard floor in CI:

- **≥ 95 %** true-accept on correct takes
- **≤ 2 %** false-accept on wrong takes (a false accept is far worse than a false
  reject — it teaches the wrong shape)

This harness is what lets you or Claude change a threshold with confidence instead of
guessing. It is the highest-leverage hour in the project.

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
