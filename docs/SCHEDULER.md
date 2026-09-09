# Scheduler: spaced repetition for a motor skill

## Algorithm: FSRS, not SM-2

Use **FSRS** (Free Spaced Repetition Scheduler) via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs).

- It is the algorithm Anki itself now ships and defaults to; SM-2 is the 1987 fallback.
- It models memory as *difficulty / stability / retrievability* and lets you set a target
  retention rate directly (e.g. "I want to remember 90 % of these"), which is a far better
  knob to expose to a user than opaque ease factors.
- Pure TypeScript, MIT, runs in the browser, no server, no dependencies.
- Same four grades as Anki (`Again` / `Hard` / `Good` / `Easy`), so the mapping below is
  a drop-in.

Do not write your own scheduler. This is a solved problem with a maintained free
implementation, and the value of the app is entirely in the *input* to the scheduler —
the fact that the grade comes from a microphone instead of a self-assessment button.

## Grade mapping

The core insight of this product: **the grade is measured, not self-reported.** Anki's
weakest link is that users lie to themselves about whether they knew it. Playing a chord
is objectively verifiable.

| What happened | Grade | FSRS rating |
| --- | --- | --- |
| Correct on first attempt, **fast** (under the speed threshold) | Easy | 4 |
| Correct on first attempt | Good | 3 |
| Correct on second attempt | Hard | 2 |
| Wrong twice, shape shown, then played correctly | Again | 1 |

The user's spec assigns three grades. Reclaiming the fourth from **time-to-correct** is
free — you already measure it — and it rewards exactly what the app exists to build:
fluency, not just accuracy. Suggested threshold: correct within **2.5 s** of the card
appearing, or better, below the user's own rolling 25th-percentile answer time for that
card type, so it adapts to a slow beginner and a fast intermediate alike.

### Two things that must not produce a grade

1. **`unclear` verdicts.** Ambient noise, a too-quiet strum, a buzzing string. Re-prompt,
   don't grade. Cap re-prompts at 2 before offering a manual override.
2. **Manual override.** There must be an "I played that right" button. Detection will
   never be perfect, and a user who is graded `Again` for a chord they played correctly
   will delete the app. Log overrides — a chord with a high override rate is a detector
   bug, and that telemetry (local, not uploaded) is a free bug tracker.

## Two-layer scheduling

FSRS is calibrated for declarative recall on a day scale. A beginner who fails an F chord
needs to see it again in *ninety seconds*, not tomorrow. So run two queues:

**Layer 1 — within-session learning queue.** An `Again` card goes to the back of a short
queue and returns after ~3 other cards, then again after ~10. It leaves the session queue
only after one clean first-try success. This is Anki's "learning steps," and it is what
makes a 10-minute session actually teach something.

**Layer 2 — FSRS day scheduler.** Governs whether the card appears *tomorrow, in 4 days,
or in 3 weeks*. Only the grade from the card's **first** presentation in a session feeds
FSRS; the repeats inside the learning queue do not, or you will corrupt the memory model.

## Card model

A card is `(chord shape, presentation type)` — not just a chord. The same chord in
different presentations exercises different memories and should schedule independently.

```ts
type PresentationType =
  | 'name_to_play'      // "Play F"                      — recall the shape from the name
  | 'diagram_to_play'   // shows a diagram               — the training-wheels version
  | 'ear_to_play'       // plays the chord, you match it — ear training
  | 'transition';       // "C → G7"                      — the one that actually matters
```

### Transitions are the real product

Nobody struggles to *hold* a C chord. Everybody struggles to get from C to F in time.
Chord **changes** are the skill that gates playing real songs, they are what a
strum-to-answer interface can uniquely measure (two onsets, two verdicts, and the
*interval between them*), and no competitor schedules them.

A transition card grades on both correctness and speed: the gap between the two onsets is
the metric. Target something like "both chords correct with under 1.2 s between onsets" for
`Good`. This makes the app measurably useful to intermediate players too, which is where
every other beginner-chord app loses its audience.

Ship `name_to_play` and `diagram_to_play` in v1; `transition` in v1.1. Design the card
model to hold all four from the first commit.

## Session budgeting

The user picks 5 / 10 / 15 / 20 minutes. Fill the queue to fit:

1. Maintain an EWMA of **seconds per card**, tracked separately per presentation type
   (transitions take longer than single chords). Seed at 8 s/card for a new user.
2. `capacity = sessionSeconds / secondsPerCard`, minus ~15 % headroom for lapses, since an
   `Again` card costs roughly 3× a `Good` one.
3. Fill with **due cards first**, ordered by overdueness (most overdue first), then
   introduce new cards up to a daily cap (default 5 — chord shapes are physically
   demanding in a way vocabulary is not; 20 new cards a day will wreck a beginner's hands).
4. If due cards alone overflow the budget, that is fine — show the most overdue and tell
   the user how many are left. Never silently drop reviews.

### Estimated time remaining

```
remaining ≈ (cardsLeft × secondsPerCard) + (expectedLapses × lapsePenalty)
```

Update after every card. Two rules keep it from feeling broken:

- **Never let it jump backwards** by more than a couple of seconds — smooth it. A timer
  that goes 3:20 → 4:10 reads as a bug even when it is more accurate.
- **Never cut a session mid-lapse.** If the clock expires while cards sit in the learning
  queue, finish them. Ending on a failure is the worst possible last impression, and
  those cards are the ones that most need the extra rep.

Show it as a thin progress bar with the time inside, not a countdown in the corner. A
prominent shrinking clock creates pressure, and pressure makes people fumble chords.

## Deck design

Ukulele's small chord vocabulary is a genuine advantage — the whole domain is masterable,
which is exactly what makes a completion-oriented SRS app satisfying. Suggested ladder:

| Tier | Chords | Unlocks |
| --- | --- | --- |
| 1 — First four | C, Am, F, G7 | Hundreds of songs. Ship this as the default deck. |
| 2 — Open majors | G, D, A, E7, Dm, Em | Most campfire repertoire |
| 3 — Sevenths | C7, D7, A7, B7, E7 | Blues, jazz standards |
| 4 — Barres | Bb, B, F#m, Bm | The wall most beginners hit |
| 5 — Colour | maj7, m7, sus2, sus4, dim, aug | Everything else |

Roughly 40 chords covers the practical universe, and ~12 covers 90 % of popular songs.
That is a *feature*: "you can finish this" is a much better story than an infinite
curriculum, and it is the honest one for ukulele.

## Data model sketch

```ts
interface ChordShape {
  id: string;            // 'C_0003'
  name: string;          // 'C'
  frets: (number|null)[];// [0,0,0,3]  — null = muted
  fingers: (number|null)[];
  tuning: TuningId;      // 'high-g' | 'low-g' | 'baritone'
  notes: number[];       // MIDI, derived — the scorer's target
  tier: number;
}

interface Card {
  id: string;            // `${shapeId}:${presentation}`
  shapeId: string;
  presentation: PresentationType;
  fsrs: FSRSCard;        // stability, difficulty, due, state, reps, lapses
}

interface ReviewLog {
  cardId: string;
  ts: number;
  grade: 1|2|3|4;
  attempts: number;
  msToCorrect: number;
  confidence: number;    // from the detector
  overridden: boolean;   // user pressed "I played that right"
}
```

Keep `ReviewLog` append-only and never delete it. It is what lets you re-tune FSRS
parameters later (FSRS supports optimizing weights against a user's own history), retune
detector thresholds against real usage, and migrate scheduling algorithms without losing
history. It is also the entire dataset you would need if you ever wanted to train a
model — locally, from the user's own playing.
