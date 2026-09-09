# uke-learner

Spaced-repetition ukulele chord trainer. Cards are answered by playing the chord on a real
ukulele; the app listens through the microphone, verifies it, and advances hands-free.

**Current state: pre-code.** The repo holds specs only. See `docs/BUILD_PROMPT.md` for the
build sequence. Update this file once code exists.

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

## Commands

_To be filled in once the project is scaffolded (Prompt 0 in `docs/BUILD_PROMPT.md`)._

```
npm run dev          # dev server
npm run build        # production build
npm run test         # unit tests
npm run test:audio   # fixture corpus + confusion matrix
npm run typecheck
npm run lint
```

## Testing audio changes

Any change to `src/audio/` must be justified by `npm run test:audio` output. Report the
confusion matrix before and after — true-accept, false-accept, false-reject, unclear.
CI floor: ≥95 % true-accept, ≤2 % false-accept.

New fixtures go in `test/fixtures/<tuning>/<CHORD>_<correct|wrong-description>_NN.wav`.

## Scope discipline

v1 is **ukulele, ~40 chords, working well**. Not guitar, not a neural model, not a
curriculum, not a backend. `docs/WORKING_WITH_CLAUDE.md` §10 explains why those are the
tempting wrong turns.
