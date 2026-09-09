import { CONFIG } from '../config';
import { midiToHz, type PitchReference, CONCERT } from '../music/pitch';
import { type Activation, type MidiNote, midi } from '../types';
import { type Spectrum } from './spectrum';

export const RANGE_SIZE = CONFIG.range.highNote - CONFIG.range.lowNote + 1;

export const noteIndex = (note: MidiNote): number => note - CONFIG.range.lowNote;
export const indexNote = (i: number): MidiNote => midi(CONFIG.range.lowNote + i);
export const inRange = (note: MidiNote): boolean =>
  note >= CONFIG.range.lowNote && note <= CONFIG.range.highNote;

/**
 * Salience of every note the instrument can physically produce.
 *
 * Deliberately *not* a 12-bin chroma. Chroma discards octave, and octave is exactly
 * what tells you which string is wrong — losing it would cost the per-string diagnosis
 * that is the point of the product (docs/DECISIONS.md #1).
 *
 * Scoring only ~29 candidate notes instead of the whole spectrum is free accuracy: the
 * instrument's range is a hard prior, so energy outside it can never be mistaken for a
 * note.
 */
/**
 * Relative amplitudes of the first partials of a plucked nylon string, normalised so the
 * fundamental is 1. Used to model how much of the spectrum a detected note explains.
 */
const PARTIAL_PROFILE = [1, 1.82, 1.42, 0.84, 0.56, 0.4] as const;

/** Bin-domain magnitude of the strongest peak near a frequency, with its bin index. */
const peakBin = (
  mag: Float64Array,
  binWidth: number,
  centre: number,
  toleranceCents: number,
): { k: number; value: number } => {
  const lo = Math.max(1, Math.floor((centre * Math.pow(2, -toleranceCents / 1200)) / binWidth));
  const hi = Math.min(mag.length - 1, Math.ceil((centre * Math.pow(2, toleranceCents / 1200)) / binWidth));
  let bestK = lo;
  let best = 0;
  for (let k = lo; k <= hi; k++) {
    if (mag[k]! > best) {
      best = mag[k]!;
      bestK = k;
    }
  }
  return { k: bestK, value: best };
};

const harmonicScore = (
  mag: Float64Array,
  binWidth: number,
  nyquist: number,
  f0: number,
): number => {
  const { count, rolloff, toleranceCents } = CONFIG.harmonics;
  let sum = 0;
  for (let h = 1; h <= count; h++) {
    const f = f0 * h;
    if (f >= nyquist) break;
    sum += peakBin(mag, binWidth, f, toleranceCents).value / Math.pow(h, rolloff);
  }
  return sum;
};

/**
 * Remove a detected note's modelled partials from the working spectrum.
 *
 * The amplitude scale is taken as the *median* ratio of observed to modelled partials
 * rather than from the fundamental alone. That matters when two notes an octave apart
 * are both sounding: the upper note's fundamental lands exactly on the lower note's
 * second partial, so any single-partial estimate would over-subtract and erase the
 * evidence for the octave. C major on a ukulele is C4 and C5 together, so this is the
 * common case, not an edge case.
 */
const subtractNote = (
  mag: Float64Array,
  binWidth: number,
  nyquist: number,
  f0: number,
  spreadBins: number,
): void => {
  const { toleranceCents } = CONFIG.harmonics;
  const ratios: number[] = [];
  for (let h = 1; h <= PARTIAL_PROFILE.length; h++) {
    const f = f0 * h;
    if (f >= nyquist) break;
    const { value } = peakBin(mag, binWidth, f, toleranceCents);
    ratios.push(value / PARTIAL_PROFILE[h - 1]!);
  }
  if (ratios.length === 0) return;
  const sorted = [...ratios].sort((a, b) => a - b);
  const scale = sorted[Math.floor((sorted.length - 1) * CONFIG.peeling.scalePercentile)]!;

  for (let h = 1; h <= PARTIAL_PROFILE.length; h++) {
    const f = f0 * h;
    if (f >= nyquist) break;
    const modelled = scale * PARTIAL_PROFILE[h - 1]!;
    const observed = peakBin(mag, binWidth, f, toleranceCents).value;
    if (observed <= 0) continue;

    // Attenuate multiplicatively rather than subtracting a flat value. Flat subtraction
    // clips the whole main lobe to zero, which destroys the one piece of evidence that
    // distinguishes "C4 ringing" from "C4 and C5 ringing": C5's fundamental sits exactly
    // on C4's second partial, so the only signal that C5 is there at all is that the bin
    // holds *more* energy than C4 alone would explain. A gain of 1 - modelled/observed
    // removes exactly the modelled share and leaves the excess — which is the residual
    // the next peeling round needs to find C5. Ukulele C major is C4 plus C5, so this is
    // the common case, not an edge case.
    const gain = Math.max(0, 1 - modelled / observed);
    const centreBin = Math.round(f / binWidth);
    for (let k = centreBin - spreadBins; k <= centreBin + spreadBins; k++) {
      if (k < 1 || k >= mag.length) continue;
      mag[k]! *= gain;
    }
  }
};

/**
 * Salience of every note the instrument can physically produce.
 *
 * Deliberately *not* a 12-bin chroma. Chroma discards octave, and octave is exactly
 * what tells you which string is wrong — losing it would cost the per-string diagnosis
 * that is the point of the product (docs/DECISIONS.md #1).
 *
 * Scoring only ~29 candidate notes instead of the whole spectrum is free accuracy: the
 * instrument's range is a hard prior, so energy outside it can never be mistaken for a
 * note.
 *
 * Notes are extracted by greedy harmonic peeling rather than scored independently. A
 * plucked C4 puts real energy at C5 and G5, and a detector that scores each candidate
 * against the raw spectrum reports both as played — with an octave ghost scoring nearly
 * as high as the note that caused it, because a nylon string's second partial is louder
 * than its fundamental. Subtracting each note's modelled partials as it is found is what
 * separates "C4 ringing" from "C4 and C5 ringing", which is the difference between a C
 * chord and a muted string.
 */
export const computeActivation = (
  spec: Spectrum,
  ref: PitchReference = CONCERT,
  scratch?: Float32Array,
): Activation => {
  const work = Float64Array.from(spec.mag);
  const nyquist = spec.sampleRate / 2;
  const f0s = new Float64Array(RANGE_SIZE);
  for (let i = 0; i < RANGE_SIZE; i++) f0s[i] = midiToHz(indexNote(i), ref);

  const spreadBins = CONFIG.peeling.subtractSpreadBins;
  const claimed = new Float64Array(RANGE_SIZE);
  const found = new Uint8Array(RANGE_SIZE);
  let firstScore = 0;

  for (let iter = 0; iter < CONFIG.peeling.maxNotes; iter++) {
    let bestIdx = -1;
    let bestScore = 0;
    for (let i = 0; i < RANGE_SIZE; i++) {
      if (found[i]) continue;
      const score = harmonicScore(work, spec.binWidth, nyquist, f0s[i]!);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;

    // Octave-error guard. Scoring the octave above a played note reuses that note's
    // even partials, and on nylon the 2nd partial is the loudest one — so the ghost an
    // octave up can genuinely outscore its own cause. Worse, peeling it first strips the
    // real note's even partials and leaves it looking absent. Prefer the lowest
    // harmonically related note that is still close in score.
    for (const drop of CONFIG.peeling.subOctaveOffsets) {
      const lower = bestIdx - drop;
      if (lower < 0 || found[lower]) continue;
      const lowerScore = harmonicScore(work, spec.binWidth, nyquist, f0s[lower]!);
      if (lowerScore >= bestScore * CONFIG.peeling.subOctaveRatio) {
        bestIdx = lower;
        bestScore = lowerScore;
        break;
      }
    }

    if (iter === 0) firstScore = bestScore;
    else if (bestScore < firstScore * CONFIG.peeling.stopRatio) break;

    found[bestIdx] = 1;
    claimed[bestIdx] = bestScore;
    subtractNote(work, spec.binWidth, nyquist, f0s[bestIdx]!, spreadBins);
  }

  // A claimed note keeps the score it had *at the moment it was claimed* — measured
  // against whatever earlier notes had already been subtracted out.
  //
  // Re-measuring claimed notes against the original spectrum is tempting, because the
  // residual value depends on peeling order and swings with small changes in strum
  // balance. It does not work: on the original spectrum a lone C4's partials give C5 a
  // strong score, so "the A string is muted" scores as well as a real C chord. The
  // residual is precisely the evidence that separates them, and giving it up trades a
  // stable metric for a false accept — the expensive error (CLAUDE.md invariant 4).
  //
  // Unclaimed notes keep their residual score too, so the activation stays a gradient
  // rather than a binary set — the verdict scorer needs the shading.
  const values = scratch ?? new Float32Array(RANGE_SIZE);
  let peak = 0;
  for (let i = 0; i < RANGE_SIZE; i++) {
    const v = found[i]
      ? claimed[i]!
      : harmonicScore(work, spec.binWidth, nyquist, f0s[i]!) * CONFIG.peeling.residualWeight;
    values[i] = v;
    if (v > peak) peak = v;
  }
  if (peak > 0) for (let i = 0; i < RANGE_SIZE; i++) values[i]! /= peak;
  else values.fill(0);

  return { lowNote: midi(CONFIG.range.lowNote), values };
};

/** Total activation across a set of notes. Notes outside the range contribute 0. */
export const sumActivation = (act: Activation, notes: readonly MidiNote[]): number => {
  let sum = 0;
  for (const n of notes) {
    const i = noteIndex(n);
    sum += i >= 0 && i < RANGE_SIZE ? act.values[i]! : 0;
  }
  return sum;
};

/** Euclidean norm of the activation vector. */
export const activationNorm = (act: Activation): number => {
  let sq = 0;
  for (let i = 0; i < RANGE_SIZE; i++) sq += act.values[i]! * act.values[i]!;
  return Math.sqrt(sq);
};

/**
 * Cosine similarity between the activation and a hypothesis's binary note template.
 *
 * The obvious scorer — mean activation over the hypothesis's notes, minus mean energy
 * elsewhere — is subtly broken, and broken in the direction that produces false accepts.
 * Dropping a note *raises* a mean if that note was below average, so "string 3 muted"
 * outscores the full chord even when every string is ringing. Sums have the mirror flaw:
 * a hypothesis with a phantom extra note scores identically to one without it.
 *
 * Cosine penalises both directions. The sqrt(|T|) denominator is what stops a subset
 * from winning; dividing by the activation norm is what stops a superset from winning.
 */
export const templateSimilarity = (act: Activation, notes: readonly MidiNote[]): number => {
  if (notes.length === 0) return 0;
  const norm = activationNorm(act);
  if (norm <= 0) return 0;
  return sumActivation(act, notes) / (Math.sqrt(notes.length) * norm);
};

/** Mean activation everywhere *except* a set of notes. Debug/diagnostic use. */
export const meanLeakage = (act: Activation, notes: readonly MidiNote[]): number => {
  const exclude = new Set(notes.map(noteIndex));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < RANGE_SIZE; i++) {
    if (exclude.has(i)) continue;
    sum += act.values[i]!;
    count++;
  }
  return count === 0 ? 0 : sum / count;
};

/** Average several activations — used across the frames of one analysis window. */
export const averageActivations = (acts: readonly Activation[]): Activation => {
  const values = new Float32Array(RANGE_SIZE);
  if (acts.length === 0) return { lowNote: midi(CONFIG.range.lowNote), values };
  for (const a of acts) for (let i = 0; i < RANGE_SIZE; i++) values[i]! += a.values[i]!;
  let peak = 0;
  for (let i = 0; i < RANGE_SIZE; i++) {
    values[i]! /= acts.length;
    if (values[i]! > peak) peak = values[i]!;
  }
  if (peak > 0) for (let i = 0; i < RANGE_SIZE; i++) values[i]! /= peak;
  return { lowNote: midi(CONFIG.range.lowNote), values };
};

/** The n strongest notes, for the debug view and per-string diagnosis. */
export const topNotes = (
  act: Activation,
  n: number,
  floor = 0.25,
): readonly { note: MidiNote; value: number }[] =>
  Array.from({ length: RANGE_SIZE }, (_, i) => ({ note: indexNote(i), value: act.values[i]! }))
    .filter((x) => x.value >= floor)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
