# uke-learner

**Live: https://dathanbn.github.io/uke-learner/**

A spaced-repetition chord trainer for ukulele. Cards are answered by **playing the
chord on a real instrument** — the app listens through the microphone, verifies what
you played, and advances on its own. You never take your hands off the uke.

Status: **feature-complete for v1, never tested on a real instrument.** Detection, both
tuner modes, the scheduler, transitions, ear training, settings, offline support and the
practice UI are built and covered by 109 tests — but every number comes from synthesised
audio. See `docs/BUILD_PROMPT.md`.

```
npm install
npm run dev          # practice app; detector debug page behind "Open"
npm run test         # everything, including the detector confusion matrix
npm run test:audio   # detector eval only
npm run test:browser # build first; checks the worklet loads in a real browser
```

Deploys to GitHub Pages on every push to the default branch, via
`.github/workflows/pages.yml` (Actions source, not the legacy branch mode — the build sets
`GITHUB_PAGES=true` so Vite uses the `/uke-learner/` base path).

**The next step is not code.** Open the debug page, press Start listening, and strum at it.
If it feels wrong, use the fixture recorder on that page — takes download named the way the
harness expects, and `npm run test:audio` scores them alongside the synthetic corpus. See
`test/fixtures/README.md`.

## The two-sentence pitch

Chords are the highest-leverage thing a beginner can memorize, and memorization is a
solved problem — spaced repetition solves it. Nobody has combined a real forgetting-curve
scheduler with audio-verified, hands-free answering, and nobody has done either one
for ukulele.

## How a session works

1. Open the app, pick a session length (5 / 10 / 15 / 20 minutes).
2. Strum all four open strings once. This calibrates input level and doubles as a tuner —
   if a string is off, the app says which one and which way.
3. A card appears: a chord name, a diagram, or a transition (`C → G7`).
4. You play it.
   - Right on the first try → graded **Good** (or **Easy** if you were fast).
   - Right on the second try → graded **Hard**.
   - Wrong twice → the app shows the shape, you play it, graded **Again**.
5. The card advances by itself. Repeat until the session clock runs out.

## Documents

| File | What it covers |
| --- | --- |
| `docs/BUILD_PROMPT.md` | The prompts to hand Claude, in build order |
| `docs/MARKET_RESEARCH.md` | Competitors, the gap, positioning |
| `docs/AUDIO_ENGINE.md` | Chord verification design — the hard part |
| `docs/SCHEDULER.md` | FSRS mapping, card model, session budgeting |
| `docs/ARCHITECTURE.md` | Stack, hosting, backend, costs, limitations |
| `docs/WORKING_WITH_CLAUDE.md` | Long-term workflow for building this with Claude |
| `docs/DECISIONS.md` | Decision log — why things are the way they are |

## Stack

Vite + React + TypeScript, Web Audio API (`AudioWorklet`) for the listener, `ts-fsrs`
for scheduling, IndexedDB for storage, deployed as a static site on GitHub Pages.
**No backend and no API keys.**

| Area | Where |
| --- | --- |
| Chord verification, peeling, onset, scoring | `src/audio/` |
| Tuning calibration and drift | `src/audio/calibration.ts` |
| FSRS, session queue, budgeting | `src/srs/` |
| Chord shapes, tunings, confusion sets | `src/music/` |
| Screens and the card state machine | `src/ui/` |
| Chord playback for ear training | `src/audio/synth.ts` |
| Synthetic corpus and the eval harness | `test/` |
