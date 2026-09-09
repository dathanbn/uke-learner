# Market research

Researched September 2026. Sources listed at the bottom.

## Summary

Three capabilities define this product:

- **(A)** a real spaced-repetition scheduler driven by the forgetting curve
- **(B)** microphone-verified, hands-free answering
- **(C)** ukulele

Every product in the market has one or two. **None has all three.** The closest is
ChordBank, which has A-ish + B for guitar; the closest ukulele product is Yousician,
which has B + C but no scheduler at all.

## The landscape

### Direct-ish: mic-listening chord trainers

**ChordBank** (iOS, guitar) — the closest competitor by mechanic. Its "Smart Flashcards"
use the microphone to listen and **flip cards automatically** with confetti, using CoreML
and Accelerate. "Chord Coach" breaks a chord down one finger at a time and listens as you
play. Decks escalate: full diagram → chord name only → pairs of chords played in sequence.
14,000+ chords.

*What it isn't:* guitar only, iOS only, and — critically — the progression is a **fixed
difficulty ladder, not a memory model**. Nothing computes when *you specifically* are about
to forget A♭m7. That is the gap.

**Uberchord** (iOS, guitar) — real-time chord recognition through the mic with feedback;
markets itself as the most advanced chord recognition available. Pricing runs **$14.99/mo
or $89.99/yr**. Recent reviews complain the note recognition "appears to be lacking," and
CB Insights lists the company as dead even though the app is still live — a product that
looks unmaintained.

*What it isn't:* guitar only, expensive, no spaced repetition.

**Chord ai** (iOS/Android/web) — recognizes chords from the mic and shows diagrams for
guitar, piano **and ukulele**. But it is a *transcription* tool — point it at a song and it
tells you the chords. It does not teach or schedule anything.

### Adjacent: full-curriculum learning apps

**Yousician** — the market leader for mic-based feedback and it **does support ukulele**.
Video lessons, real-time listening, gamified. Documented weaknesses in reviews: pitch
detection that mishears correct playing, a hard plateau past beginner levels, and
aggressive auto-renewing subscriptions.

*What it isn't:* song- and lesson-driven, not memory-driven. There is no concept of "this
chord is due today." It also spreads across guitar/piano/bass/uke/vocals, so ukulele gets
a fraction of the attention.

**Fender Play, Simply Guitar, Gibson App, Justin Guitar** — curriculum products, guitar-
centric, some with real-time feedback. Same structural gap: linear courses, no scheduler.

**GuitarTuna** — tuner plus casual chord games. Enormous install base, very shallow
practice model.

### Adjacent: spaced repetition without audio

**Rukus+ Guitar Chord Flashcards** (iOS, 2025) — a daily chord trainer, 70+ chords,
curated and custom decks. Guitar, and grading is manual.

**Anki / Quizlet / Cram ukulele decks** — these exist and people genuinely use them. They
prove demand for exactly this. They are also miserable for the purpose: you grade yourself,
which is the failure mode SRS is most vulnerable to, and you have to put the instrument
down to press a button.

**Chunks, SmartCards+, Fresh Cards, Repetitions** — general SRS apps, no instrument
awareness.

Notably, one 2026 SRS roundup makes the point directly: spaced repetition helps the
*knowledge* underlying a skill, but "the skills themselves require additional practice that
spacing alone does not provide." That is a fair criticism of Anki-with-uke-cards — and the
precise thing audio verification fixes, since the answer *is* the physical practice rep.

## Where the gap is

| | SRS scheduler | Mic-verified answers | Ukulele | Web / no install | Free tier |
| --- | :---: | :---: | :---: | :---: | :---: |
| ChordBank | ✗ (ladder) | ✓ | ✗ | ✗ | partial |
| Uberchord | ✗ | ✓ | ✗ | ✗ | limited |
| Yousician | ✗ | ✓ | ✓ | ✗ | trial |
| Chord ai | ✗ | ✓ (transcribe) | ✓ | partial | partial |
| Rukus+ | partial | ✗ | ✗ | ✗ | ? |
| Anki + uke deck | ✓ | ✗ | n/a | partial | ✓ |
| **uke-learner** | **✓** | **✓** | **✓** | **✓** | **✓** |

## Positioning

**"The Anki of ukulele chords."** Not a competitor to Yousician — a *supplement*. Ten
minutes a day of chord drilling, next to whatever lessons someone is already taking. That
framing is both easier to sell and much cheaper to build: you are not writing a curriculum,
recording video, or licensing songs. It also gives a clean answer to "why would I use this
instead of Yousician" — you wouldn't, you'd use both, and this one is free.

Call it a **chord gym**, not a guitar teacher.

## Five ways to differentiate

1. **Ukulele-first, and treat the constraint as the moat.** The uke's 4 strings, one-octave
   range, and ~40-chord universe make the audio problem *tractable* in a way guitar's 6
   strings and 14,000 chords are not. ChordBank could add ukulele — but its architecture is
   built around a guitar-sized problem, and the entrenched players are all guitar-first
   because that is where the money is. Being small is why you can be better here.

2. **Chord transitions as scheduled cards.** Nobody does this. It is the actual skill, it
   is measurable with the interface you are already building (two onsets, one interval),
   and it extends the product's useful life past the beginner plateau that reviewers
   complain about in every competitor.

3. **Per-string diagnosis instead of right/wrong.** "Your ring finger is on the 2nd fret,
   should be the 3rd" is a categorically better product than a red X. See
   `docs/AUDIO_ENGINE.md` — the architecture gives you this nearly for free, and it is the
   most demo-able feature you will have.

4. **Free, open, local-first, no account.** Against $14.99/mo Uberchord and Yousician's
   subscription reputation, "open the URL and play" is a real wedge. No signup is the
   single biggest conversion lever you have.

5. **Shareable decks.** Anki's actual moat was never the algorithm — it was shared decks.
   A plain-text/JSON deck format that people can fork ("Hawaiian standards," "jazz uke,"
   "songs my teacher assigned") is the only durable defensibility available to a solo
   project, and it is cheap if you design the format early. Retrofitting it is expensive.

## Risks

- **ChordBank ships ukulele.** Plausible; they have the detection stack already. Mitigation
  is the scheduler and open decks, not the audio — assume the audio advantage is temporary.
- **Detection quality is the whole product.** Yousician has a large team and reviewers
  still say it mishears them. If false rejects are common the app is unusable. This is why
  `docs/AUDIO_ENGINE.md` insists on the eval harness before the UI.
- **Market size.** Ukulele players are a fraction of guitar players. Fine for a portfolio
  project, an open-source tool, or a small paid product; not a venture-scale market. If it
  works, the instrument-agnostic data model (built in from day one) is the growth path —
  guitar next, then mandolin/banjo, which are also underserved.
- **Retention is hard for all SRS apps.** Streaks, a visible "chords mastered" count against
  a *finite* total, and short sessions are the standard mitigations. The finite total is
  your advantage — "you know 31 of 40 chords" is far more motivating than an endless deck.

## Sources

- [Best Spaced Repetition Apps 2026 — Chunks](https://chunks.app/blog/best-spaced-repetition-apps-2026)
- [ChordBank — Smart Flashcards](https://chordbank.com/o/flash/) · [Chord Coach](https://chordbank.com/o/chordtraining/) · [App Store](https://apps.apple.com/us/app/chordbank-learn-guitar-chords/id397602509)
- [Uberchord](https://www.uberchord.com/) · [FAQ / pricing](https://www.uberchord.com/faq/) · [GuitarPlayer coverage](https://www.guitarplayer.com/gear/the-uberchord-guitar-chord-recognition-app-works-in-real-time) · [CB Insights](https://www.cbinsights.com/company/uberchord)
- [Chord ai](https://chordai.net/)
- [Best ukulele learning apps — Preply](https://preply.com/en/blog/best-ukulele-learning-apps/) · [10 Best Ukulele Apps — Uke Like The Pros](https://blog.ukelikethepros.com/ukulele-apps/) · [19 Best Ukulele Apps — Ukulele World](https://www.ukuleleworld.com/best-ukulele-apps/)
- [Music learning apps ranked 2026 — Unstar](https://unstar.app/blog/yousician-simply-piano-flowkey-fender-play-music-learning-apps-ranked-2026)
- [Rukus+ Guitar Chord Flashcards](https://apps.apple.com/us/app/rukus-guitar-chord-flashcards/id6746895025)
- [Ukulele chord flashcards on Quizlet](https://quizlet.com/28534242/ukulele-chords-flash-cards/) · [Cram](https://www.cram.com/flashcards/ukulele-chords-5304318)
- [Am7 / C6 ambiguity — Ukulele Underground](https://forum.ukuleleunderground.com/threads/am7-chord-and-c6-chord-confused.46280/)
- [Spaced repetition — Wikipedia](https://en.wikipedia.org/wiki/Spaced_repetition) · [Anki — Wikipedia](https://en.wikipedia.org/wiki/Anki)
