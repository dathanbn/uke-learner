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
