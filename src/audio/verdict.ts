import { CONFIG } from '../config';
import { confusionSet, type Hypothesis } from '../music/confusion';
import { noteName } from '../music/pitch';
import { getShape, resolveShape } from '../music/shapes';
import {
  type Activation,
  type MidiNote,
  type StringDiagnosis,
  type StringIndex,
  type TargetShape,
  type Verdict,
} from '../types';
import { noteIndex, RANGE_SIZE, indexNote, templateSimilarity } from './activation';

export interface ScoredHypothesis {
  id: string;
  label: string;
  confidence: number;
}

const confidenceOf = (act: Activation, notes: readonly MidiNote[]): number =>
  templateSimilarity(act, notes);

/** Cached per (shape, tuning) — the confusion set is a pure function of both. */
const confusionCache = new Map<string, readonly Hypothesis[]>();
const confusionFor = (shapeId: string, tuningId: string): readonly Hypothesis[] => {
  const key = `${shapeId}@${tuningId}`;
  let c = confusionCache.get(key);
  if (!c) {
    c = confusionSet(getShape(shapeId), tuningId);
    confusionCache.set(key, c);
  }
  return c;
};

/**
 * Which note is actually sounding closest to where this string should be?
 * Searches a fifth either side, which covers every fingering error worth naming.
 */
const heardNear = (
  act: Activation,
  expected: MidiNote,
  /** Notes the *other* strings account for. Without excluding these, a chord's own
   *  neighbouring string gets reported as this string's mistake — on a C chord, the
   *  open G is five semitones from the A string's target and would win every search. */
  claimedByOthers: ReadonlySet<number>,
  radius = 7,
): MidiNote | null => {
  let best: MidiNote | null = null;
  let bestVal = 0.3;
  for (let d = -radius; d <= radius; d++) {
    const i = noteIndex(expected) + d;
    if (i < 0 || i >= RANGE_SIZE) continue;
    const note = indexNote(i);
    if (claimedByOthers.has(note)) continue;
    const v = act.values[i]!;
    if (v > bestVal) {
      bestVal = v;
      best = note;
    }
  }
  return best;
};

/**
 * Per-string diagnosis. This is the pedagogical payload: a beginner told *which finger*
 * is wrong fixes it in one attempt instead of ten. It is available only because
 * activation keeps octave information — a chroma vector could not produce this.
 */
export const diagnose = (act: Activation, target: TargetShape): readonly StringDiagnosis[] =>
  target.perString.map((expected, idx): StringDiagnosis => {
    const string = idx as StringIndex;
    if (expected === null) {
      return { string, fault: { kind: 'ok' } };
    }
    const present = act.values[noteIndex(expected)] ?? 0;
    if (present >= 0.45) return { string, fault: { kind: 'ok' } };

    const claimedByOthers = new Set<number>(
      target.perString.filter((n, i): n is MidiNote => i !== idx && n !== null),
    );
    const heard = heardNear(act, expected, claimedByOthers);
    if (heard === null || heard === expected) {
      return { string, fault: { kind: 'missing', expected } };
    }
    return {
      string,
      fault: { kind: 'wrong_fret', expected, heard, fretDelta: heard - expected },
    };
  });

export interface ScoreResult {
  verdict: Verdict;
  targetConfidence: number;
  ranked: readonly ScoredHypothesis[];
}

/**
 * Score an activation against the target and its near misses.
 *
 * The target must both clear an absolute floor and beat the best alternative by a
 * margin. The margin is the main false-accept control, and false accepts are the
 * expensive error: a false reject annoys the user, a false accept teaches them the
 * wrong shape (CLAUDE.md invariant 4).
 */
/**
 * Score an activation against the target and its near misses.
 *
 * Three outcomes, and the distinction between the last two matters: `incorrect` means we
 * heard a chord clearly and it wasn't the one asked for; `unclear` means we couldn't tell
 * what we heard. Only the first is allowed to produce a grade (CLAUDE.md invariant 5) —
 * grading someone "Again" because a truck drove past is how the app gets deleted.
 *
 * A correct call needs the target to clear an absolute floor *and* beat the best
 * alternative by a margin. The margin is the main false-accept control, and false accepts
 * are the expensive error: a false reject annoys the user, a false accept teaches them the
 * wrong shape (invariant 4).
 */
export const scoreAgainstTarget = (
  act: Activation,
  shapeId: string,
  rms: number,
  tuningId = 'high-g',
  sensitivity = 1,
): ScoreResult => {
  const target = resolveShape(getShape(shapeId), tuningId);
  const targetConfidence = confidenceOf(act, target.notes);
  const unclear = (reason: 'too_quiet' | 'no_onset' | 'ambiguous'): ScoreResult => ({
    verdict: { kind: 'unclear', reason },
    targetConfidence,
    ranked: [],
  });

  if (rms < CONFIG.verdict.minRms) return unclear('too_quiet');

  let strong = 0;
  for (let i = 0; i < RANGE_SIZE; i++) {
    if (act.values[i]! >= CONFIG.verdict.strongNoteFloor) strong++;
  }
  if (strong < CONFIG.verdict.minStrongNotes) return unclear('ambiguous');

  const ranked = confusionFor(shapeId, tuningId)
    .map(
      (h): ScoredHypothesis => ({
        id: h.id,
        label: h.label,
        confidence: confidenceOf(act, h.target.notes),
      }),
    )
    .sort((a, b) => b.confidence - a.confidence);

  const best = ranked[0] ?? null;
  const margin = targetConfidence - (best?.confidence ?? -Infinity);

  // `sensitivity` is the user-facing escape hatch for a room the detector finds hard.
  // Above 1 it relaxes both thresholds, which trades false rejects for false accepts —
  // the expensive direction (CLAUDE.md invariant 4) — so the settings copy says so, and
  // the range is deliberately narrow.
  const minConfidence = CONFIG.verdict.minConfidence / sensitivity;
  const minMargin = CONFIG.verdict.minMargin / sensitivity;

  if (targetConfidence >= minConfidence && margin >= minMargin) {
    return {
      verdict: { kind: 'correct', confidence: targetConfidence, runnerUp: best?.label ?? null, margin },
      targetConfidence,
      ranked,
    };
  }

  // A near-tie is the one case worth refusing to call. Guessing here is exactly how a
  // false accept happens, and re-prompting costs the user two seconds.
  if (targetConfidence >= minConfidence && Math.abs(margin) < minMargin) {
    return { verdict: { kind: 'unclear', reason: 'ambiguous' }, targetConfidence, ranked };
  }

  return {
    verdict: {
      kind: 'incorrect',
      confidence: targetConfidence,
      bestAlternative: best && best.confidence > targetConfidence ? best.label : null,
      perString: diagnose(act, target),
    },
    targetConfidence,
    ranked,
  };
};

export const describeDiagnosis = (d: StringDiagnosis): string | null => {
  const stringLabel = `String ${4 - d.string}`;
  switch (d.fault.kind) {
    case 'ok':
      return null;
    case 'missing':
      return `${stringLabel} (${noteName(d.fault.expected)}) isn't sounding — muted or damped.`;
    case 'wrong_fret': {
      const dir = d.fault.fretDelta > 0 ? 'high' : 'low';
      const n = Math.abs(d.fault.fretDelta);
      return `${stringLabel} should be ${noteName(d.fault.expected)}, heard ${noteName(
        d.fault.heard,
      )} — ${n} fret${n > 1 ? 's' : ''} too ${dir}.`;
    }
    case 'unexpected':
      return `${stringLabel} is ringing (${noteName(d.fault.heard)}) but shouldn't be.`;
  }
};
