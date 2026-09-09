import { CONFIG } from '../config';
import { midiToHz, noteName, referenceFromOffset, type PitchReference, CONCERT } from '../music/pitch';
import { getTuning } from '../music/tunings';
import { type Cents, type MidiNote, type StringIndex, cents, hz } from '../types';
import { peakFrequencyNear, type Spectrum } from './spectrum';

/**
 * Automatic tuning calibration.
 *
 * The important distinction, and the reason this can be partly but not wholly automatic:
 *
 *   GLOBAL offset  — the whole instrument sits N cents from A440. Every interval is
 *                    still correct, so every chord is still correct. Nothing is wrong
 *                    with the instrument; only our reference was wrong. Absorb it
 *                    silently and let the user play.
 *
 *   RELATIVE error — the strings disagree with *each other*. The intervals themselves
 *                    are wrong, so the chords genuinely sound wrong. This cannot be
 *                    absorbed: shifting our expectations to match would mean grading a
 *                    learner correct for a chord that sounds bad, and training their ear
 *                    on it. It also eats the margin the detector needs — a string 50
 *                    cents sharp leaves 50 cents of headroom before it looks like the
 *                    next fret, which drives false accepts.
 *
 * So: absorb global offset automatically, and only interrupt the user for relative error.
 */

export interface StringReading {
  string: StringIndex;
  expected: MidiNote;
  /** Measured fundamental, or null when nothing convincing was found. */
  measuredHz: number | null;
  /** Deviation from the *nominal* (A440) pitch of the expected note. */
  deviationCents: Cents | null;
  confidence: number;
}

export type CalibrationOutcome =
  /** In tune with itself and close enough to concert pitch. Nothing to say. */
  | { kind: 'in_tune'; reference: PitchReference; offsetCents: Cents; readings: readonly StringReading[] }
  /** In tune with itself but shifted. Absorbed automatically — the user does nothing. */
  | { kind: 'auto_adjusted'; reference: PitchReference; offsetCents: Cents; readings: readonly StringReading[] }
  /** Strings disagree with each other. The user has to actually tune. */
  | {
      kind: 'needs_tuning';
      offsetCents: Cents;
      spreadCents: Cents;
      /** Cents each string must move, *after* removing the global offset. */
      corrections: readonly { string: StringIndex; note: string; cents: Cents }[];
      readings: readonly StringReading[];
    }
  /** Too far out, or too little signal, to say anything responsible. */
  | { kind: 'unusable'; reason: 'no_signal' | 'off_by_more_than_a_semitone'; readings: readonly StringReading[] };

/**
 * Estimate one string's fundamental by grid search with harmonic reinforcement.
 *
 * Single-peak picking fails here: nylon strings have a weak fundamental, so the loudest
 * bin near the nominal pitch is often noise. Summing the first three partials of each
 * candidate makes the true pitch the clear winner.
 */
const estimateStringPitch = (
  spec: Spectrum,
  nominalHz: number,
  windowCents: number,
): { frequency: number; strength: number } => {
  // Coarse pass: locate the string. Summing the first three partials of each candidate
  // makes the true pitch the clear winner even though a nylon string's fundamental is
  // weak enough that the loudest bin near it is often noise.
  let best = { frequency: nominalHz, strength: 0 };
  for (let c = -windowCents; c <= windowCents; c += 4) {
    const f = nominalHz * Math.pow(2, c / 1200);
    let sum = 0;
    for (let h = 1; h <= 3; h++) {
      const fh = f * h;
      if (fh >= spec.sampleRate / 2) break;
      const k = Math.round(fh / spec.binWidth);
      const m = Math.max(spec.mag[k - 1] ?? 0, spec.mag[k] ?? 0, spec.mag[k + 1] ?? 0);
      sum += m / h;
    }
    if (sum > best.strength) best = { frequency: f, strength: sum };
  }
  if (best.strength <= 0) return best;

  // Refine. The coarse pass takes a maximum over three bins, which at G4 is a plateau
  // roughly ±24 cents wide — fine for finding the string, useless for a tuner, where
  // being 12 cents out is the difference between "in tune" and "tune your G string".
  // Parabolic interpolation on each partial's actual peak gives sub-bin resolution, and
  // higher partials give more cents per bin, so they carry more weight.
  const estimates: { f0: number; weight: number }[] = [];
  for (let h = 1; h <= 3; h++) {
    const fh = best.frequency * h;
    if (fh >= spec.sampleRate / 2) break;
    const peak = peakFrequencyNear(spec, hz(fh), 28);
    if (peak.magnitude > 0 && peak.frequency > 0) {
      estimates.push({ f0: peak.frequency / h, weight: peak.magnitude * h });
    }
  }
  if (estimates.length === 0) return best;

  const totalWeight = estimates.reduce((a, e) => a + e.weight, 0);
  const refined = estimates.reduce((a, e) => a + e.f0 * e.weight, 0) / totalWeight;

  // Only accept the refinement if it stayed near the coarse estimate; a wild jump means
  // a partial got captured by a neighbouring string rather than this one.
  const driftCents = Math.abs(1200 * Math.log2(refined / best.frequency));
  return driftCents <= 40 ? { frequency: refined, strength: best.strength } : best;
};

/** Read all four open strings from a strum (or an arpeggio — same code path). */
export const readOpenStrings = (spec: Spectrum, tuningId: string): readonly StringReading[] => {
  const open = getTuning(tuningId).openNotes;
  const strengths: number[] = [];
  const raw = open.map((note, i) => {
    const nominal = midiToHz(note, CONCERT);
    const est = estimateStringPitch(spec, nominal, CONFIG.calibration.searchWindowCents);
    strengths.push(est.strength);
    return { i: i as StringIndex, note, est, nominal };
  });

  const maxStrength = Math.max(...strengths, 1e-9);
  return raw.map(({ i, note, est, nominal }): StringReading => {
    const confidence = est.strength / maxStrength;
    // A string that barely registered is a missing reading, not a wrong one. Reporting
    // a confident deviation from noise is worse than reporting nothing.
    const usable = confidence >= 0.22 && est.strength > 0;
    return {
      string: i,
      expected: note,
      measuredHz: usable ? est.frequency : null,
      deviationCents: usable ? cents(1200 * Math.log2(est.frequency / nominal)) : null,
      confidence,
    };
  });
};

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * Turn readings into a decision.
 *
 * The global offset is the *median* deviation, not the mean: one badly out string
 * shouldn't drag the reference with it, which is exactly what a mean would do.
 */
export const interpretReadings = (readings: readonly StringReading[]): CalibrationOutcome => {
  const usable = readings.filter(
    (r): r is StringReading & { deviationCents: Cents } => r.deviationCents !== null,
  );
  if (usable.length < 3) {
    return { kind: 'unusable', reason: 'no_signal', readings };
  }

  const deviations = usable.map((r) => r.deviationCents);
  const offset = cents(median(deviations));

  if (Math.abs(offset) > CONFIG.calibration.maxGlobalOffsetCents) {
    // Past this point we can no longer be sure which note is which — a string 90 cents
    // flat is nearly the note below it, and guessing would corrupt every later verdict.
    return { kind: 'unusable', reason: 'off_by_more_than_a_semitone', readings };
  }

  const relative = usable.map((r) => r.deviationCents - offset);
  const spread = cents(Math.max(...relative) - Math.min(...relative));
  const reference = referenceFromOffset(offset);

  // Readings this inconsistent mean the search locked onto the wrong strings — usually
  // because the instrument is far enough out that each string drifted into its
  // neighbour's window. Naming a string to tune here would be confident nonsense.
  if (spread > CONFIG.calibration.maxTrustableSpreadCents) {
    return { kind: 'unusable', reason: 'off_by_more_than_a_semitone', readings };
  }

  if (spread > CONFIG.calibration.maxRelativeSpreadCents) {
    const corrections = usable
      .map((r) => ({
        string: r.string,
        note: noteName(r.expected),
        cents: cents(-(r.deviationCents - offset)),
      }))
      .filter((c) => Math.abs(c.cents) >= CONFIG.calibration.ignoreBelowCents)
      .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
    return { kind: 'needs_tuning', offsetCents: offset, spreadCents: spread, corrections, readings };
  }

  return Math.abs(offset) < CONFIG.calibration.ignoreBelowCents
    ? { kind: 'in_tune', reference, offsetCents: offset, readings }
    : { kind: 'auto_adjusted', reference, offsetCents: offset, readings };
};

export const calibrate = (spec: Spectrum, tuningId: string): CalibrationOutcome =>
  interpretReadings(readOpenStrings(spec, tuningId));

/**
 * Tracks pitch drift *during* a session without interrupting it.
 *
 * Nylon strings go flat measurably within a single session, especially a fresh set, and
 * stopping a hands-free drill every few minutes to re-tune would wreck the one thing the
 * product is for. Instead every accepted strum contributes a free offset observation;
 * we only interrupt once the running estimate has moved far enough to matter.
 */
export class DriftTracker {
  private estimate: number;
  private observations = 0;

  constructor(initialOffsetCents: Cents = cents(0)) {
    this.estimate = initialOffsetCents;
  }

  /** Measure how far a known-correct chord actually landed from where we expected it. */
  observe(spec: Spectrum, soundingNotes: readonly MidiNote[], ref: PitchReference): Cents | null {
    const errors: number[] = [];
    for (const note of soundingNotes) {
      const expected = midiToHz(note, ref);
      const est = estimateStringPitch(spec, expected, 45);
      if (est.strength <= 0) continue;
      errors.push(1200 * Math.log2(est.frequency / expected));
    }
    if (errors.length < 2) return null;

    // `observed` is measured against the current reference, which already includes the
    // running estimate, so the target absolute offset is estimate + observed. The EWMA
    // toward that target reduces to a simple nudge.
    const observed = median(errors);
    this.estimate += CONFIG.calibration.driftEwmaAlpha * observed;
    this.observations++;
    return cents(this.estimate);
  }

  get offsetCents(): Cents {
    return cents(this.estimate);
  }

  get reference(): PitchReference {
    return referenceFromOffset(cents(this.estimate));
  }

  /** True once drift is both trustworthy and large enough to be worth a re-check. */
  needsRecheck(baselineOffset: Cents): boolean {
    return (
      this.observations >= CONFIG.calibration.driftMinObservations &&
      Math.abs(this.estimate - baselineOffset) >= CONFIG.calibration.driftRecheckCents
    );
  }

  reset(offset: Cents = cents(0)): void {
    this.estimate = offset;
    this.observations = 0;
  }
}

/** One-line summary for the UI. Silence is the right output for a healthy instrument. */
export const describeCalibration = (o: CalibrationOutcome): string => {
  switch (o.kind) {
    case 'in_tune':
      return 'In tune.';
    case 'auto_adjusted':
      return `In tune with itself, ${Math.abs(Math.round(o.offsetCents))} cents ${
        o.offsetCents > 0 ? 'sharp' : 'flat'
      } of concert pitch — adjusted, carry on.`;
    case 'needs_tuning': {
      const worst = o.corrections[0];
      if (!worst) return 'Strings disagree slightly.';
      return `${worst.note} string is ${Math.abs(Math.round(worst.cents))} cents ${
        worst.cents > 0 ? 'flat' : 'sharp'
      } relative to the others — tune it ${worst.cents > 0 ? 'up' : 'down'}.`;
    }
    case 'unusable':
      return o.reason === 'no_signal'
        ? "Didn't hear all four strings — strum again, a bit louder."
        : 'That is more than a semitone out. Tune roughly by ear first, then strum again.';
  }
};

export const hzOf = (note: MidiNote, ref: PitchReference): number => hz(midiToHz(note, ref));
