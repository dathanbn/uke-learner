# Working with Claude on this project long-term

The goal is a setup where you can come back after three weeks, say "the F chord keeps
false-rejecting," and get a correct fix — without re-explaining the project.

## 1. `CLAUDE.md` is the highest-leverage file in the repo

Claude Code reads `CLAUDE.md` from the repo root automatically at the start of every
session. Everything in it is context you never have to type again. This repo already has
one; keep it current as the project's actual constraints change.

What belongs in it: build/test commands, the non-obvious invariants (voice processing must
stay off, DSP stays off the main thread, false accepts are worse than false rejects), the
directory map, and the conventions you care about. What does not: anything that changes
weekly, or long prose. It is a briefing, not a manual — every token in it costs context on
every single session.

You can regenerate or extend it with `/init`, and add to it mid-session by starting a
message with `#`, which appends the line to `CLAUDE.md` for you.

## 2. The golden-fixture corpus is what makes this maintainable

This is the most important practice in the whole document. Once `test/fixtures/` holds
real recordings of you playing each chord right and wrong, the audio engine becomes
**measurable**, and a measurable system is one an AI can improve safely. Without it, every
threshold change is a guess and regressions are invisible until a user hits them.

Concretely, this converts "make the F chord detection better" from an unanswerable request
into a loop Claude can close by itself: change a constant, run the harness, read the
confusion matrix, keep or revert. Record fixtures on your phone, from across the room,
with a different ukulele, on a bad day. Every awkward recording is a permanent regression
test.

Add to the corpus every time you hit a false reject in real use. That one habit compounds
more than anything else here.

## 3. Plan before building anything structural

For any change touching more than a couple of files, use **plan mode** (`Shift+Tab` twice)
so Claude researches and proposes an approach before writing code. Reviewing a plan takes
two minutes; reviewing a wrong 600-line implementation takes an hour, and you will be
tempted to keep it because it exists.

Small, obvious changes don't need it. "Refactor how the session queue is built" does.

## 4. Keep changes on branches, and let Claude open the PRs

Work on a branch per feature, let Claude commit and open a draft PR, then review the diff
on GitHub rather than in the terminal. Two reasons this matters here specifically: audio
changes are hard to review as a wall of terminal output, and a PR gives you a place to
paste "here's what the confusion matrix did" as the actual justification for a threshold
change.

Useful built-ins once a PR is open:
- `/code-review` — reviews the current diff for correctness bugs
- `/security-review` — worth running before you ever add a backend or an API proxy

## 5. Write project skills for the loops you repeat

A skill is a folder in `.claude/skills/<name>/SKILL.md` describing a repeatable task.
Claude loads it when the work matches. The three worth writing for this project:

- **`add-chord`** — adding a chord means updating shapes data, deriving MIDI notes,
  generating the confusion set, recording fixtures, and extending the deck tier. That is a
  five-step checklist you will run forty times. Write it down once.
- **`tune-detector`** — the loop from §2: run the harness, read the matrix, adjust one
  constant, re-run, report both rates. Encoding "never trade a lower false-reject rate for
  a higher false-accept rate" into the skill means you never have to re-argue it.
- **`record-fixtures`** — the naming convention and what takes are needed for a new chord.

Use `/skill-creator` to scaffold them. Skills are the difference between explaining your
workflow every session and having it just happen.

## 6. Set up a session-start hook early

If you plan to use Claude Code on the web (worth it — you can kick off work from your
phone), add a `SessionStart` hook so a fresh cloud container installs dependencies and can
actually run the tests. Without it, every web session starts by failing to run `npm test`.
The `/session-start-hook` skill sets this up.

Note the real limitation: **a cloud session has no microphone and no ukulele.** It can do
the scheduler, the UI, the harness, and the data work — everything except the one thing
that needs your hands. Split work accordingly: audio tuning is local-only, everything else
is delegatable.

## 7. Keep a decision log

`docs/DECISIONS.md` records *why*, in a few lines each. This is not bureaucracy — it is
the thing that stops you and Claude from re-litigating "why don't we just use chroma" for
the fourth time, and it is what makes a session six months from now productive instead of
archaeological. Add an entry whenever you reject an approach for a reason that isn't
obvious from the code.

## 8. A realistic weekly rhythm

- **Local, with the ukulele in your hands:** audio tuning, fixture recording, anything you
  have to *hear* to judge. Use the debug page constantly.
- **Local, hands-free:** scheduler logic, UI work, data modelling. Plan mode for the big
  ones.
- **Web / async:** documentation, test coverage, refactors, dependency updates, CI. Fire
  these off from your phone and review the PRs later.
- **After every real practice session you do as a user:** if something felt wrong, record
  a fixture or open an issue while you still remember it. You are the only tester you have.

## 9. Things to deliberately not delegate

- **Deciding what "correct" sounds like.** Only you can say whether a slightly buzzy F
  should pass. Encode the answer in fixtures, don't ask for a judgement call.
- **Threshold changes without the harness.** If the harness is red or missing, a
  confident-sounding tuning change is a coin flip.
- **The product feel.** Whether the session pacing is fun is not measurable from here.

## 10. Guard against the specific failure mode of this project

The seductive wrong turn is a big, impressive-looking rewrite of the audio engine —
swapping in a neural model, or generalising to "any instrument." Both are plausible
suggestions and both will cost weeks and probably lose accuracy on the narrow case that
actually matters. `docs/AUDIO_ENGINE.md` and `docs/DECISIONS.md` exist partly to make that
argument once, in writing, so it doesn't get re-made every time the code is touched.

Ship ukulele, with four chords, working well.
