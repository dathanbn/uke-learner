---
name: tune-detector
description: Change a DSP constant in src/config.ts and prove the effect on detector accuracy. Use whenever adjusting thresholds, peeling parameters, onset settings, or investigating a false accept or false reject.
---

# Tuning the detector

Never change a constant in `src/config.ts` without measuring. The whole point of the
harness is that this loop is closed; guessing at thresholds is how an audio project
degrades into folklore.

## The loop

1. `npm run test:audio` — record the *current* confusion matrix before touching anything.
2. Change **one** thing.
3. `npm run test:audio` again.
4. Report both matrices: true-accept, false-accept, false-reject, unclear.
5. Keep the change only if false-accept did not rise. Otherwise revert and say so.

## Rules that are not negotiable

- **False accepts are worse than false rejects.** A false reject annoys someone and they
  strum again; a false accept teaches them a wrong chord shape, silently. Never trade one
  for the other without stating it explicitly.
- **Never move a threshold to make a test pass.** If a test fails, the detector regressed
  or the test is wrong. Decide which, and say which.
- **`peeling.scalePercentile` and `peeling.subtractSpreadBins` are one setting.** Sweep
  them together — individually each looks flat, and the joint optimum is narrow.
- **Watch for tuning to noise.** With too few takes the metric swings several points on
  the random seed alone. The eval runs six playing conditions per chord for this reason. If
  a sweep result looks decisive, re-run it with different seeds before believing it.

## Sweeping

Write a throwaway test that mutates `CONFIG` and prints a row per configuration, run it,
then **delete it** — a committed sweep is a 20-second test that tests nothing. Report the
table in the commit message or the PR, not the file.

## When real fixtures exist

`test/fixtures/**/*.wav` is scored by the same harness and held to the same floor. Real
audio moves the optimum: the synthetic corpus has no reverb, no fret buzz, no intonation
error. When both corpora disagree, the real one wins, and the constants should be retuned
against it with the synthetic corpus kept only as a regression guard.

## Reporting

Say plainly whether a result came from synthetic or real audio. Synthetic accuracy is a
floor on difficulty, not a measure of field accuracy, and quoting it without that caveat
misleads.
