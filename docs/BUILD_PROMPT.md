# Build prompts

## Read this first: why there is no single prompt

The instinct is to write one enormous prompt describing the whole app and paste it into
Claude. That reliably produces a plausible-looking app whose audio engine does not work,
because the hard part gets 5 % of the attention and you have no way to tell.

What actually works is a **persistent context file plus a sequence of milestone prompts**,
each with acceptance criteria you can check. `CLAUDE.md` in the repo root is read
automatically at the start of every Claude Code session, so the project's invariants
never have to be re-explained. The prompts below then stay short, because the context is
already loaded.

Order matters enormously: **build the riskiest thing first.** If chord detection doesn't
feel good, the scheduler and the UI are wasted work.

---

## Prompt 0 — Scaffold

Use this once, in an empty repo. Run it in **plan mode** first (`Shift+Tab` twice in
Claude Code) so you can review the structure before any files are written.

````text
Set up a new Vite + React + TypeScript project for a ukulele chord trainer.

Read docs/ARCHITECTURE.md, docs/AUDIO_ENGINE.md, and docs/SCHEDULER.md in this repo
first — they contain the design decisions I want you to follow. Don't re-derive them.

Create:
- Vite + React 18 + TypeScript, configured with base: '/uke-learner/' for GitHub Pages
- Vitest for unit tests, ESLint + Prettier
- The src/ layout described in docs/ARCHITECTURE.md: audio/, srs/, data/, store/, ui/
- A GitHub Actions workflow that runs typecheck + lint + test on PRs, and a separate
  one that deploys to GitHub Pages on push to main
- A stub src/data/tunings.ts and src/data/shapes.ts with the correct MIDI note numbers
  for high-G reentrant tuning and the four Tier 1 chords (C, Am, F, G7)
- Branded types for MidiNote, Hz, Cents, and FretNumber in src/types.ts, so they can't
  be mixed up

Don't build any UI beyond a placeholder App. Don't add a state management library.
Don't add Tailwind — I'll use plain CSS with custom properties.

Verify by running the build, typecheck, and tests, and show me the output.
````

---

## Prompt 1 — The audio spike (the important one)

Do not skip ahead to the app. This prompt is the project.

````text
Build a standalone debug page at /debug/audio that proves chord detection works.
Read docs/AUDIO_ENGINE.md first and follow its design — particularly the
"verification, not identification" reframe and the note-activation approach. Do not
implement generic chord recognition and do not use a chroma vector.

Requirements:

1. Mic capture via getUserMedia with echoCancellation, noiseSuppression and
   autoGainControl all explicitly false. Read back track.getSettings() and show a
   visible warning if the browser ignored any of them.

2. An AudioWorklet that computes, per hop:
   - RMS level
   - spectral flux onset detection with a moving-median threshold and 120ms refractory
   - a note-activation vector over MIDI 60..88 using harmonic summation
     (5 harmonics, 1/h weighting, ±50 cent tolerance per harmonic, octave-ghost
     suppression)

3. A verdict scorer: given a target shape, score the target against a generated
   confusion set (each string ±1/±2 frets, each fretted string opened, each string
   muted) and return correct / incorrect / unclear per the Verdict type in the doc.

4. The debug UI shows, live:
   - input level meter and whether voice processing is off
   - a bar chart of the note-activation vector, labelled with note names
   - onset markers on a scrolling timeline
   - a dropdown to pick the target chord (C, Am, F, G7)
   - the current verdict, its confidence, and — when incorrect — the per-string
     diagnosis ("string 3 should be C, heard C#")

5. All DSP runs in the AudioWorklet or a Worker. Nothing heavier than rendering on the
   main thread.

Acceptance: I can open the page, strum a C, and see it identified as correct within
300ms of the strum, with the per-string readout matching what I actually fretted.

Put every tunable constant (harmonic count, thresholds, window offsets, margin) in a
single exported config object so I can tweak them without hunting.
````

Then go play your ukulele at it for twenty minutes. This is the moment you find out
whether the product is viable, and it happens on day one instead of week six.

---

## Prompt 2 — The evaluation harness

Record fixtures **before** running this: for each of C, Am, F, G7, capture 2–3 correct
takes and 2–3 characteristic wrong takes (one finger a fret off, one string muted, one
string not pressed down). Phone voice-memo quality is fine. Name them descriptively.

````text
Build a headless evaluation harness for the chord detector.

- Refactor the DSP so the analysis pipeline can run on a Float32Array offline, with no
  AudioContext, and share exactly the same code path as the realtime worklet. This
  matters: I don't want the tested code and the shipped code to diverge.
- Add a Vitest suite that decodes every WAV in test/fixtures/, runs the detector, and
  reports a confusion matrix: true accepts, false accepts, false rejects, unclear.
- Fail CI if true-accept rate on correct takes is below 95%, or false-accept rate on
  wrong takes is above 2%.
- Add an npm script that prints the matrix in a readable table so I can watch it change
  as we tune.

Then tune the config constants against the corpus and show me the before/after matrix.
Do not change thresholds without reporting the effect on both rates — I care much more
about false accepts than false rejects, because a false accept teaches the wrong shape.
````

From here on, **every audio change is measured, not guessed.** This is what makes the
project maintainable by Claude over months instead of degrading into threshold roulette.

---

## Prompt 3 — Scheduler

````text
Implement the spaced repetition layer per docs/SCHEDULER.md. No UI, no audio — this
should be fully testable headlessly.

- ts-fsrs wrapper exposing: grade(card, rating) -> updated card, and dueCards(now)
- The within-session learning queue: an "Again" card returns after ~3 cards, then ~10,
  and leaves the queue after one clean first-try success. Only the FIRST presentation
  of a card in a session feeds FSRS.
- The grade mapping from attempts + time-to-correct, including the Easy grade for fast
  first-try answers using a per-user rolling percentile rather than a fixed constant.
- Session budgeting: given a target duration, fill the queue with due cards by
  overdueness then new cards up to a daily cap, using an EWMA of seconds-per-card
  tracked per presentation type.
- Estimated-time-remaining that is smoothed so it never jumps backwards by more than
  2 seconds.
- IndexedDB persistence via idb: cards, review logs (append-only), settings.

Tests: simulate 90 days of a user with a known error pattern and assert the intervals
behave sensibly — mastered chords spread out, a chord they keep failing keeps coming
back, and a 10-minute session actually lands within 10% of 10 minutes.
````

---

## Prompt 4 — Session UI

````text
Build the practice session UI. Light, playful theme — warm off-white background, soft
rounded cards, one saturated accent colour. Not a dark developer aesthetic.

Flow:
1. Home: pick session length with a slider (5–20 min), see streak and "chords mastered
   / total"
2. Calibration: "strum all four strings" — sets input gain and checks tuning; if a
   string is out, show which one and which direction, and let them retune before
   continuing
3. Session: chord card, hands-free advancement per the state machine below, thin
   progress bar with estimated time remaining inside it
4. Summary: cards reviewed, accuracy, chords due tomorrow, and 2-3 songs playable with
   what they know

Card state machine:
  PROMPT -> (correct) -> GOOD/EASY -> next card
         -> (incorrect) -> RETRY prompt -> (correct) -> HARD -> next
                                        -> (incorrect) -> REVEAL shape
                                                       -> wait for correct play
                                                       -> AGAIN -> next
  Any 'unclear' verdict re-prompts without grading, max 2 times, then offers the
  manual override.

Requirements:
- Everything must be operable by playing the instrument. Buttons exist but are a
  fallback, not the primary path.
- An always-available "I played that right" override button that logs the override.
- Screen Wake Lock while a session is active.
- Respect prefers-reduced-motion; the confetti is optional.
- Accessible: the verdict must not be communicated by colour alone.
````

---

## Prompt 5 — Tuner and polish

````text
1. Build the tuner properly: strum-based coarse check, falling back to a guided
   arpeggio (one string at a time) using monophonic pitch detection via pitchy when the
   strum reading is ambiguous. Show cents deviation per string with a needle. Support
   high-G, low-G, and baritone tunings from the tunings data table.

2. Make it a PWA: service worker, offline support, installable manifest, app icons.

3. Add a settings page: tuning, daily new-card cap, target retention (pass through to
   FSRS), detector sensitivity, and export/import of all data as JSON.

The JSON export is important — it's the deck-sharing format and the backup mechanism.
Design it as a stable, documented, versioned schema, not a dump of internal state.
````

---

## If you want one prompt anyway

For a quick throwaway prototype — not the real build — this is the version to use. It
still puts the audio first, which is the part that matters:

````text
Build a single-page web prototype (Vite + React + TypeScript, no backend) that drills
ukulele chords with spaced repetition, where the user answers by playing the chord on a
real ukulele and the app listens through the microphone.

Critical design constraints:
- The app always KNOWS which chord it asked for, so this is chord VERIFICATION, not
  chord identification. Score the audio against the target's expected MIDI notes and
  against a generated confusion set (each string ±1-2 frets, opened, or muted). Do not
  build a general chord recognizer — on ukulele it's ambiguous by construction (C6 and
  Am7 are the same four notes).
- Standard high-G reentrant tuning: G4 392Hz, C4 261.6Hz, E4 329.6Hz, A4 440Hz.
  Restrict note detection to MIDI 60-88 and use harmonic summation, not raw peak
  picking — nylon strings have weak fundamentals.
- getUserMedia MUST set echoCancellation, noiseSuppression and autoGainControl to
  false, or musical signal gets destroyed by speech processing.
- Detect strum onsets with spectral flux, then analyse the window 80-250ms after the
  onset. Don't classify continuously — the previous chord is still ringing.
- Use ts-fsrs for scheduling. Grade from behaviour: first-try correct = Good,
  second-try correct = Hard, needed the answer shown = Again.
- All DSP off the main thread. Verdict on screen within 300ms of the strum.
- Store cards and an append-only review log in IndexedDB.

Start with four chords: C (0003), Am (2000), F (2010), G7 (0212).
Light, playful visual theme. Session length selectable 5-20 minutes with estimated time
remaining shown.

Build the audio detection and a debug view for it FIRST, and let me test that it
actually works before you build the card UI on top of it.
````

## Prompting notes that generalise

- **Say what not to build.** "Do not build a general chord recognizer" and "do not use a
  chroma vector" prevent the most likely wrong turns, which are wrong turns precisely
  because they are what the training data is full of.
- **Give acceptance criteria you can physically check**, not "make it work well."
- **Put tunable constants in one object** and say so. You will be tweaking them by ear.
- **Ask for the debug view.** An audio bug you cannot see is an audio bug you cannot fix,
  by yourself or with Claude.
- **Include the numbers.** 392 Hz, MIDI 60–88, 80–250 ms, 300 ms. Specific constants in a
  prompt do far more work than adjectives.
- **Point at the docs instead of restating them.** `docs/AUDIO_ENGINE.md` is the spec;
  prompts should reference it so there is one source of truth to update.
