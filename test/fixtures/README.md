# Real fixture corpus

Empty on purpose. Every accuracy number in this repo comes from synthesised audio
(`test/synth.ts`), which has no room reverb, no fret buzz, no intonation error and no
microphone response. Those numbers are a floor on difficulty, **not** a measure of how well
the detector works in a room.

## Recording takes

1. `npm run dev`, open the app, go to **Detector debug**, press **Start listening**.
2. Scroll to **Record a fixture**. Pick the chord and what you're about to play.
3. Record, play, stop. The file downloads with the right name.
4. Move it into `test/fixtures/<tuning>/`.
5. `npm run test:audio` scores it alongside the synthetic corpus.

## Naming

```
test/fixtures/<tuning>/<CHORD>_<correct|wrong-description>_NN.wav
```

```
test/fixtures/high-g/C_correct_01.wav
test/fixtures/high-g/C_wrong-string-1-1-fret-flat_01.wav
test/fixtures/high-g/F_wrong-string-2-muted_02.wav
```

The recorder generates these names for you. `correct` is the only special token; anything
else is treated as a take that must be rejected.

## What to record

Two or three correct takes per chord, plus the mistakes you actually make — not
hypothetical ones. Then deliberately awkward conditions, because those are what break a
detector that works fine on the desk:

- across the room, and very close
- a phone mic as well as a laptop
- a second instrument if you have one
- a room with hard surfaces
- straight after changing strings, when the tuning is drifting
- a genuinely quiet strum

Every take you add is a permanent regression test. When the app rejects a chord you know
you played correctly, record that take — that is the most valuable file in the corpus.
