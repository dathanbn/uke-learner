# Decision log

Short entries. Why, not what. Add one whenever you reject an option for a reason that
isn't obvious from reading the code.

---

### 1. Verification, not identification
**Decision:** The detector scores audio against the chord the app already asked for, plus a
generated confusion set. It never answers "what chord is this?"

**Why:** Ukulele's reentrant tuning and one-octave range make open-set chord identification
genuinely ambiguous — C6 and Am7 are the same four notes, and there is no bass note to
disambiguate. But we always know the target, so the hard problem never has to be solved.
This also gives per-string diagnosis for free.

**Rejected:** general chord recognition via chroma/HPCP template matching. Loses octave
information, which is exactly what tells you *which string* is wrong.

---

### 2. Classical DSP, not a neural model
**Decision:** Hand-rolled FFT + harmonic summation over MIDI 60–88.

**Why:** The restricted range and known target make this sufficient. It is small, fast,
debuggable, and every failure has a legible cause. `@spotify/basic-pitch` is real
polyphonic transcription but carries ~120 ms latency and a non-causal note-creation step —
wrong shape for a realtime loop, and it can't be tuned against our specific confusion set.

**Revisit if:** the fixture corpus shows a ceiling on accuracy that constant-tuning can't
move. Keep basic-pitch in mind as an offline oracle, not the hot path.

---

### 3. FSRS via `ts-fsrs`, not SM-2 and not homegrown
**Decision:** Use the maintained TypeScript FSRS implementation.

**Why:** It's what Anki itself defaults to now, it's free and MIT, it runs in the browser
with no server, and it exposes target retention as a user-facing knob. The novelty of this
product is the *input* to the scheduler (a microphone instead of a self-report button), not
the scheduler.

---

### 4. Cards target a specific voicing
**Decision:** A card is a chord *shape*, and the scorer targets that shape's exact notes.
Playing a different valid voicing of the same chord reads as incorrect.

**Why:** The card is teaching a hand shape, and accepting any voicing would make the
diagnosis feature meaningless. Alternate voicings get their own cards later.

**Consequence:** card IDs are shape-based (`C_0003`), not name-based.

---

### 5. Local-first, no backend for v1
**Decision:** IndexedDB is the source of truth. Static deploy to GitHub Pages.

**Why:** Every capability the app needs — mic, DSP, scheduling, storage — is a free browser
primitive. No API keys, no per-user cost, no signup friction, works offline. A server is
only required for cross-device sync, which is a v2 problem. When it arrives it's a sync
target, never a dependency, so the audio loop never touches the network.

---

### 6. Instrument model is data-driven from commit one
**Decision:** Tunings and shapes are data tables, not constants, even though v1 ships
ukulele only.

**Why:** Costs almost nothing now and is expensive to retrofit. Guitar, low-G, and baritone
become content changes rather than rewrites.

**Not a licence to build for guitar now.** See `docs/WORKING_WITH_CLAUDE.md` §10.

---

### 7. False accepts are worse than false rejects
**Decision:** CI floor is ≥95 % true-accept and ≤2 % false-accept, and any tuning change
must report both.

**Why:** A false reject is annoying and the user retries. A false accept teaches a wrong
shape and silently corrupts the thing the app exists to build. They are not symmetric and
the thresholds should not be tuned as though they are.

---

### 8. Global tuning offset is absorbed; relative error is not
**Decision:** Calibration measures each open string, takes the **median** deviation as a
global offset, and moves the detector's pitch reference by it. Disagreement *between*
strings is reported to the user instead.

**Why:** A ukulele 40 cents flat is in tune with itself — every interval, and therefore
every chord, is correct. Only our reference was wrong, so making a beginner chase A440
before they may practise is friction for no benefit. Relative error is the opposite: the
intervals themselves are wrong, so absorbing it would grade someone correct for a chord
that sounds bad and train their ear on it. It also eats detector margin — a string 50 cents
sharp leaves 50 cents before it looks like the next fret.

**Consequence:** `searchWindowCents` (90) bounds `maxGlobalOffsetCents` (70). The window
must stay under half the closest open-string interval (G4→A4, 200 cents) or one string's
search locks onto its neighbour — and it fails exactly when the instrument is flat.

---

### 9. Greedy harmonic peeling, not per-note ghost penalties
**Decision:** Extract notes by iteratively scoring, claiming the strongest, and attenuating
its modelled partials out of a working spectrum. Claimed notes keep the score they had when
claimed; unclaimed notes keep their residual.

**Why:** The first implementation scored every candidate independently and subtracted a
fixed penalty for harmonic relationships. It could not distinguish a played C5 from C4's
second partial, because on a nylon string that partial is *louder than the fundamental*.
The residual after peeling is the only evidence that separates them.

**Rejected:** re-measuring claimed notes against the original spectrum. It looks like a
robustness win — residual magnitude depends on peeling order and is noisy — but it was
tried and produced a false accept on "the A string is muted" for a C chord. Stability is
not worth a false accept (see #7).

---

### 10. Cosine similarity against a binary template, not mean activation
**Decision:** `confidence(T) = Σ a(n) / (sqrt(|T|)·‖a‖)` over the hypothesis's notes.

**Why:** The obvious scorer — mean activation over the target minus mean energy elsewhere —
is broken in the direction that causes false accepts. Dropping a note raises a mean when
that note was below average, so "string 3 muted" outscored the full chord even with every
string ringing, and no Tier 1 chord could be verified. Plain sums have the mirror flaw: a
phantom extra note costs nothing. The two denominators fix each direction.

---

### 11. The evaluation corpus is synthetic *for now*, and says so everywhere
**Decision:** `test/synth.ts` generates plucked-string audio; the harness runs it under six
playing conditions and enforces the CI floor against it.

**Why:** It makes the detector testable on a machine with no microphone and no ukulele,
which is most CI runs and every cloud session. It found two real bugs before any recording
existed.

**Limits, which must be repeated whenever the numbers are quoted:** no room reverb, no fret
buzz, no intonation error, no microphone response. The thresholds in `src/config.ts` are
tuned against it and will move once real fixtures land. Synthetic accuracy is a floor on
difficulty, not a measure of field accuracy.
