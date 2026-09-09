# uke-learner

Spaced-repetition ukulele chord trainer. Cards are answered by playing the chord on a real
ukulele; the app listens through the microphone, verifies it, and advances hands-free.

**Current state:** feature-complete for v1. Detection, calibration (strum + guided
arpeggio), FSRS scheduling, transitions, ear training, streaks, settings, offline PWA, the
practice UI and a detector debug page are built and tested (109 tests). See
`docs/BUILD_PROMPT.md`.

**Never verified with a real ukulele.** Everything is tuned against synthetic audio. The
first session with an actual instrument will find things nothing here can predict.

## Push back when I'm wrong

I am not a signal-processing or music-theory expert, and I would rather be corrected than
agreed with. If I propose something that won't work, say so directly and explain why, with
the specific reason — don't build it anyway and don't soften it into "great idea, though
one consideration is…". Say which part of the idea is right, which part isn't, and what to
do instead.

The same applies to measurements. If a change makes the numbers worse, say so and revert
it; don't move a threshold to make a test pass. If a result comes from synthetic audio and
might not survive contact with a real ukulele, say that too. A confident wrong answer here
costs weeks, because audio bugs are invisible until someone is standing there with an
instrument wondering why the app won't advance.

## Read before changing audio code

`docs/AUDIO_ENGINE.md` is the spec for the detector. `docs/DECISIONS.md` records why the
approach is what it is. Don't re-derive either.

## Invariants

These are load-bearing. Breaking any of them silently breaks the product.

1. **Verification, not identification.** The app always knows the target chord. Score
   against it and a generated confusion set. Never build a general chord recognizer —
   ukulele chord names are ambiguous by construction (C6 and Am7 are the same four notes).
2. **Voice processing must stay off.** `getUserMedia` must set `echoCancellation`,
   `noiseSuppression`, and `autoGainControl` to `false`. They default to `true` and destroy
   musical signal.
3. **All DSP off the main thread** — AudioWorklet or Worker. A dropped frame is a missed
   strum.
4. **False accepts are worse than false rejects.** A false reject annoys; a false accept
   teaches the wrong chord shape. Never trade one for the other without saying so.
5. **Never grade on an `unclear` verdict.** Re-prompt instead. Grading someone `Again`
   because a truck went past is how the app gets deleted.
6. **The realtime and offline analysis paths share one code path.** If the tested code
   diverges from the shipped code, the test suite is decoration.
7. **Local-first.** IndexedDB is the source of truth. No network call is ever in the path
   of a practice session.
8. **Only a card's first presentation in a session feeds FSRS.** The within-session
   learning queue repeats a failed card; feeding those repeats to the day-scale model
   would tell it the card was reviewed five times today and corrupt every interval after.
9. **Learning steps count presentations, not queue position.** A lapse answer does not
   advance the queue, so scheduling a repeat against the queue index makes it due
   immediately and forever — one card the learner keeps failing then blocks the session.
10. **The UI resets on `presentationKey`, never on card id.** The same card is legitimately
    presented twice in a row once the queue drains into the learning queue. Keying the card
    state machine on the id freezes the app at the end of any session containing a lapse.
11. **There is always a way out of a card.** The reveal phase assumes the learner *can*
    form the shape; meeting a first barre chord they often can't. "Can't play this yet"
    must stay reachable, and it grades Again rather than punishing.
12. **Never trap someone on the calibration screen.** An instrument that won't tune is
    still worth practising on. Offer the guided arpeggio, then let them proceed anyway.

## Domain facts — tuning and calibration

There are two different kinds of "out of tune" and they need opposite treatment:

- **Global offset** — the whole instrument sits N cents from A440. Every interval, and
  therefore every chord, is still correct; only our reference was wrong. **Absorb this
  automatically** by moving the detector's reference (`PitchReference`), and say nothing.
  Making a beginner chase A440 before they may practise is friction for no benefit.
- **Relative error** — the strings disagree with each other. The intervals themselves are
  wrong, so the chords genuinely sound wrong. **Never absorb this.** Software-correcting it
  would grade someone correct for a chord that sounds bad and train their ear on it, and it
  eats the margin the detector needs — a string 50 cents sharp leaves 50 cents before it
  looks like the next fret, which drives false accepts.

Consequences that are easy to get wrong:
- The global offset is the **median** of per-string deviations, never the mean: one badly
  out string must not drag the reference with it.
- `searchWindowCents` must stay well under half the closest interval between two open
  strings — 200 cents on high-G (G4→A4). A wider window makes one string's search lock onto
  its neighbour, and it fails precisely when the instrument is flat.
- Drift is tracked passively from correct plays and only interrupts past a threshold. Nylon
  goes flat measurably within one session; stopping a hands-free drill every few minutes to
  retune would wreck the thing the product is for.

## Domain facts

- Standard tuning is **high-G reentrant**: G4 392.0, C4 261.6, E4 329.6, A4 440.0 Hz.
  The 4th string is *higher* than the 3rd. There is no bass note.
- Detection range: MIDI **60–88** (C4 to E6).
- Tier 1 chords: C `0003`, Am `2000`, F `2010`, G7 `0212`.
- Nylon strings have weak fundamentals and strong 2nd/3rd partials — always use harmonic
  summation, never raw fundamental peak-picking.
- Latency budget: strum onset to on-screen verdict under **300 ms**.

## Conventions

- TypeScript strict. Branded types for `MidiNote` / `Hz` / `Cents` / `FretNumber` — they're
  all `number` and they *will* get mixed up.
- Every tunable DSP constant lives in one exported config object. Never inline a threshold.
- Review logs are append-only. Never delete or rewrite history.
- Chord/tuning data are data tables, not constants.
- Card IDs are shape-based (`C_0003:name_to_play`), not name-based.
- Shapes resolve against the *active* tuning, not the shape's own. High-G and low-G share
  fret patterns; resolving against the wrong one reports a muted 4th string on every chord.
- Transitions and ear cards unlock only once their chords are solid, and are excluded from
  the "is this chord known" check — including them would make unlocking circular.

## Commands

_To be filled in once the project is scaffolded (Prompt 0 in `docs/BUILD_PROMPT.md`)._

```
npm run dev          # dev server, then open the detector debug page
npm run build        # typecheck + production build
npm run test         # all tests (~25s; the eval harness dominates)
npm run test:audio   # detector eval only — prints the confusion matrix
npm run typecheck
```

## Testing audio changes

Any change to `src/audio/` must be justified by `npm run test:audio` output. Report the
confusion matrix before and after — true-accept, false-accept, false-reject, unclear.
CI floor: ≥95 % true-accept, ≤2 % false-accept. Currently **97.8 % / 0 %**.

**The corpus is synthetic.** `test/synth.ts` models a plucked nylon string; it cannot
produce room reverb, fret buzz, a cheap instrument's intonation, or a phone mic's response.
Treat the numbers as a floor on difficulty, not a measure of field accuracy, and say so when
quoting them. Real fixtures go in
`test/fixtures/<tuning>/<CHORD>_<correct|wrong-description>_NN.wav` and run through the same
code path.

Two traps this project has already hit, both of which cost real time:

1. **Tuning to noise.** With few takes the metric swings several points on nothing but a
   different random seed, which is enough to make a parameter sweep pick a meaningless
   winner. The eval runs each chord under six playing conditions for this reason. If you
   change the corpus size, re-check that a repeated run gives the same answer before
   trusting a sweep.
2. **Parameters that interact.** `peeling.scalePercentile` and `peeling.subtractSpreadBins`
   are effectively one setting — sweep them together. Individually each looks flat.

## Project skills

`.claude/skills/` holds the three workflows this project repeats: `tune-detector` (change a
constant, prove the effect), `add-chord` (the six-step checklist), and `record-fixtures`
(building the real corpus). Read the relevant one before doing that kind of work, and add
to it when you learn something.

## Scope discipline

v1 is **ukulele, ~40 chords, working well**. Not guitar, not a neural model, not a
curriculum, not a backend. `docs/WORKING_WITH_CLAUDE.md` §10 explains why those are the
tempting wrong turns.
