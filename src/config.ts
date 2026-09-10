/**
 * Every tunable DSP constant lives here. Never inline a threshold — you will be
 * adjusting these by ear against test/fixtures, and hunting them through the codebase
 * makes that loop miserable.
 *
 * Any change to these must be justified with `npm run test:audio` output: report the
 * confusion matrix before and after. False accepts are worse than false rejects
 * (CLAUDE.md invariant 4) — never trade one for the other silently.
 */
export const CONFIG = {
  analysis: {
    /** Samples per analysis frame. 4096 @ 44.1k = ~93ms — long enough to resolve
     *  adjacent semitones near C4, which are only ~15Hz apart. */
    frameSize: 4096,
    /** Zero-pad before the FFT for finer bin spacing (interpolation, not new information). */
    fftSize: 8192,
    hopSize: 1024,
  },

  range: {
    /** C4 — the lowest note a standard high-G ukulele can produce. */
    lowNote: 60,
    /** E6 — 12th fret of the A string, plus headroom. */
    highNote: 88,
  },

  harmonics: {
    /** Nylon strings have a weak fundamental and strong 2nd/3rd partials, so summing
     *  harmonics is far more stable than peak-picking the fundamental. */
    count: 5,
    /** Weight of harmonic h is 1/h^rolloff. */
    rolloff: 1.0,
    /** Search window around each expected harmonic. Wide enough to tolerate the
     *  intonation error of a cheap instrument, narrow enough not to catch neighbours
     *  (a semitone is 100 cents). */
    toleranceCents: 50,
  },

  peeling: {
    /** A ukulele sounds at most 4 notes; the headroom catches sympathetic ringing. */
    maxNotes: 6,
    /** Stop peeling once a candidate falls this far below the strongest note found. */
    stopRatio: 0.16,
    /** Unclaimed notes keep a fraction of their residual score, so the activation stays
     *  a gradient rather than a binary set — the verdict scorer needs the shading. */
    residualWeight: 0.85,
    /** Octave-error guard. A nylon string's 2nd partial is *louder* than its fundamental,
     *  so the note an octave above a played note can outscore it. When a harmonically
     *  related lower note scores at least this fraction of the winner, peel the lower one
     *  first — it is nearly always the one actually being played. */
    subOctaveRatio: 0.62,
    /** Semitone drops to check for that guard: octave, octave+fifth, two octaves. */
    subOctaveOffsets: [12, 19, 24],
    /**
     * Percentile of the observed/modelled partial ratios used as a note's amplitude
     * scale. A low percentile picks the harmonic least contaminated by other notes and
     * so deliberately under-subtracts; the median is pulled upward by exactly the
     * partials another note is sharing, which erases the evidence for that note.
     *
     * This and subtractSpreadBins interact strongly, and the optimum is narrow: on the
     * synthetic corpus, (0.25, 2) gives 95.6% true-accept while (0.25, 1) gives 71% and
     * (0.25, 3) gives 80%. Treat the pair as one setting, sweep them together, and expect
     * the optimum to move once test/fixtures/ holds real recordings.
     */
    scalePercentile: 0.25,
    /**
     * Half-width, in bins, of the region attenuated around each modelled partial.
     * Narrow is deliberate: the peak search takes the maximum over a ±50 cent window, so
     * flattening the peak itself is enough to remove the note, while a wide region also
     * flattens the sidelobes and neighbouring partials that other notes need.
     */
    subtractSpreadBins: 2,
  },

  ghost: {
    /** How much of a lower note's energy is subtracted from notes sitting on its
     *  harmonic series. Without this, the 3rd partial of C4 lights up G5 and the
     *  detector "hears" notes nobody played. */
    alpha: 0.55,
    /** Semitone offsets of harmonics 2..5 above a fundamental: 12, 19.02, 24, 27.86. */
    harmonicSemitones: [12, 19, 24, 28],
    toleranceCents: 60,
  },

  onset: {
    /** Frames of history for the moving-median flux threshold. */
    medianWindow: 17,
    /** Flux must exceed median * multiplier + floor to count as an onset. */
    thresholdMultiplier: 2.2,
    thresholdFloor: 0.008,
    /** One strum is one onset. Blocks the individual string attacks within a strum. */
    refractoryMs: 120,
    /** Hysteresis: after an onset, flux must fall back below threshold * this before
     *  another can fire. The refractory period alone is not enough — an analysis frame
     *  is ~93ms long, so energy from the last string of a strum is still *entering* the
     *  window when the refractory expires, and the rising flux reads as a second strum. */
    rearmRatio: 0.75,
  },

  window: {
    /** Start scoring this long after the onset — past the broadband pick transient. */
    startMs: 80,
    /** Stop before the chord decays into the noise floor. */
    endMs: 250,
  },

  verdict: {
    /**
     * NOTE: these are tuned against the synthetic corpus in test/synth.ts, which is
     * cleaner than any real room. Expect to loosen minConfidence and tighten minMargin
     * once test/fixtures/ holds real recordings — and re-run `npm run test:audio` to
     * see what it costs in false accepts before keeping any change.
     */
    /** Absolute floor for calling a play correct. Correct synthetic plays score ~0.90. */
    minConfidence: 0.66,
    /**
     * The target must beat the best confusion-set alternative by this much — the
     * ambiguity guard, and the main false-accept control.
     *
     * Swept against the synthetic corpus (90 correct takes across 6 playing conditions,
     * 238 near misses):
     *
     *   margin  true-accept  false-accept
     *   0.000      98.9%        0.00%
     *   0.005      98.9%        0.00%
     *   0.015      97.8%        0.00%
     *   0.030      87.8%        0.00%
     *
     * False accepts stay at zero throughout, so synthetic audio shows no benefit from a
     * margin at all. It is kept deliberately anyway: synthetic near misses are cleanly
     * wrong, and a real room — reverb smearing partials, a buzzing string, the previous
     * chord still ringing — is exactly where two hypotheses land close together. Zero
     * margin would remove the only mechanism that refuses to guess. Re-sweep once
     * test/fixtures/ holds real recordings; that is the run where this number earns
     * its keep.
     */
    minMargin: 0.015,
    /** Activation above which a note counts as clearly sounding. Used to tell "I heard
     *  a chord, it wasn't yours" (incorrect) from "I couldn't hear you" (unclear). */
    strongNoteFloor: 0.5,
    /** Fewer clear notes than this and we heard noise, not a chord. */
    minStrongNotes: 2,
    /** RMS below this is silence, not a quiet strum. */
    minRms: 0.004,
  },

  calibration: {
    /** How far the whole instrument may sit from A440 and still be auto-accepted.
     *  Bounded by searchWindowCents below — we cannot absorb an offset larger than the
     *  window we are willing to look in. Beyond this the honest answer is "tune roughly
     *  by ear first", which is what the unusable outcome says. */
    maxGlobalOffsetCents: 70,
    /** Spread between strings *after* removing the global offset. Above this the
     *  instrument is out of tune with itself and no software correction is honest. */
    maxRelativeSpreadCents: 18,
    /** Below this, don't even mention it — it's inaudible and nagging is worse. */
    ignoreBelowCents: 5,
    /** Spread beyond which the readings themselves are not credible: a real instrument
     *  is rarely this inconsistent, so it means the search locked onto the wrong strings.
     *  Say so, rather than confidently naming a string to tune. */
    maxTrustableSpreadCents: 60,
    /**
     * Search window around each expected open string.
     *
     * Must stay well under half the closest interval between two open strings, which on a
     * high-G ukulele is G4→A4 at just 200 cents. A wider window lets the search for one
     * string lock onto its neighbour — and it fails exactly when the instrument is flat,
     * because the shift walks each string toward the next one's window.
     */
    searchWindowCents: 90,
    /** Drift beyond this during a session triggers a re-check prompt. */
    driftRecheckCents: 22,
    /** Weight of each new observation in the running offset estimate. */
    driftEwmaAlpha: 0.18,
    /** Observations required before the running estimate is trusted. */
    driftMinObservations: 6,
  },

  reference: {
    /** Concert pitch. Calibration adjusts the *working* reference away from this;
     *  this constant stays put as the nominal. */
    a4Hz: 440,
  },

  /**
   * The on-screen input meter.
   *
   * Display only — nothing here feeds detection. It exists because "can it actually hear
   * me?" is the first thing a learner wonders, and a meter that moves with the room is the
   * only honest answer. Never fake movement while the input is silent: a meter that twitches
   * at nothing teaches them to distrust everything else the app says.
   */
  meter: {
    /** RMS mapped to an empty meter — matches verdict.minRms, below which we hear nothing. */
    floorRms: 0.004,
    /** RMS mapped to a full meter: roughly a firm strum at a propped-up phone's distance. */
    fullRms: 0.15,
    /** Bar height at silence, so the meter reads as resting rather than dead. */
    restingScale: 0.18,
    /** Per-frame smoothing. Rising fast keeps a strum feeling instant; falling slowly keeps
     *  the meter readable rather than strobing. */
    attack: 0.5,
    release: 0.12,
  },
} as const;

export type Config = typeof CONFIG;
