---
name: add-chord
description: Add a new chord shape to the deck. Use when adding chords to src/music/shapes.ts, extending a tier, or supporting a new voicing.
---

# Adding a chord

Six steps. Missing any one leaves a chord that looks fine in the picker and misbehaves in
a session.

## 1. Add the shape

`src/music/shapes.ts`, in tier order:

```ts
s('Bb_3211', 'Bb', [3, 2, 1, 1], 4),
```

- id is `<Name>_<frets>`, so alternate voicings of the same chord get distinct cards.
- Fret array is `[G, C, E, A]` — 4th string first. `0` is open, `null` is muted.
- Tier follows `docs/SCHEDULER.md`: 1 first four, 2 open majors/minors, 3 sevenths,
  4 barres, 5 colour.

## 2. Check the pitches

`resolveShape` derives MIDI notes from the active tuning — do not hand-write them. Verify
in a test that the resolved note set is the chord you meant, and remember ukulele chord
names are ambiguous (C6 and Am7 are the same four notes), so check the *pitches*, not the
name.

## 3. Check the confusion set

`confusionSet(shape)` generates near misses automatically. Confirm it produces the mistake
a learner actually makes on this chord, and that nothing in it resolves to the target's own
pitches — a duplicate makes the margin test unsatisfiable and the chord unverifiable.

## 4. Run the evaluation

`npm run test:audio`. A new chord is included automatically if its tier is ≤ 3. If it drags
the numbers down, that is information about the chord, not a reason to loosen a threshold —
barre chords with duplicated pitches are genuinely harder to verify.

## 5. Record fixtures

Use the fixture recorder on the debug page. Two or three correct takes, plus the mistakes
you actually make on it. See `.claude/skills/record-fixtures/SKILL.md`.

## 6. Check the diagram

Barre shapes above the 4th fret shift the diagram window. Open the debug page and look at
it — the fret-number label and dot placement are easy to get subtly wrong and impossible to
notice in a test.

## Do not

- Hand-write MIDI numbers anywhere.
- Add baritone shapes to this table. DGBE makes the same fret pattern a different chord; it
  needs its own table and `SHAPE_COMPATIBLE` updated.
