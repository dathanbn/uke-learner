---
name: record-fixtures
description: Capture real recordings of a ukulele into test/fixtures for the detector evaluation. Use when building or extending the real audio corpus, or after the app misjudges a chord that was played correctly.
---

# Recording fixtures

The corpus is the ground truth the detector is tuned against. Every number in this repo
without real files behind it is synthetic, and synthetic audio has no room, no buzz, no
intonation error and no microphone.

## How

1. `npm run dev` → **Detector debug** → **Start listening**.
2. **Record a fixture**: choose the chord and what you're about to play. The wrong-take
   options come from the same confusion generator the detector scores against, so a
   recorded mistake lines up with the hypothesis it exercises.
3. Record, play, stop. The file downloads correctly named.
4. Move it to `test/fixtures/<tuning>/`.
5. `npm run test:audio`.

## What is actually worth recording

Not more clean takes at a desk. The valuable files are the awkward ones:

- across the room, and very close to the mic
- a phone as well as a laptop
- a second instrument, especially a cheap one that intonates badly
- a hard-surfaced room with real reverb
- immediately after a string change, while tuning is still drifting
- a genuinely quiet strum
- the mistakes you personally make, not hypothetical ones

**The single most valuable file is a take the app got wrong.** When a chord you know you
played correctly is rejected, record it immediately. That is a permanent regression test
for a failure mode nobody would have thought to synthesise.

## Naming

```
test/fixtures/<tuning>/<CHORD>_<correct|wrong-description>_NN.wav
```

`correct` is the only special token. Anything else is a take that must be rejected. The
recorder generates these names; only rename by hand if you must, and keep the convention.

## Balance

Roughly 3 correct takes per chord against 3–6 wrong ones. Heavily skewing toward correct
takes makes false accepts invisible, which is the error that matters most.
