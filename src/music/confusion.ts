import { type ChordShape, type MidiNote, type TargetShape } from '../types';
import { resolveShape, toFretTuple } from './shapes';

/**
 * A wrong-but-plausible version of a target shape.
 *
 * The detector never asks "what chord is this?" — it asks "does this match the target
 * better than the things a learner actually plays when they mean the target?"
 * (docs/DECISIONS.md #1). This module generates that comparison set mechanically, so
 * adding a chord doesn't mean hand-authoring its failure modes.
 */
export interface Hypothesis {
  id: string;
  /** Human-readable cause, shown in the debug view and used for diagnosis. */
  label: string;
  target: TargetShape;
  /** Which string went wrong, when the fault is localised to one. */
  string: number | null;
}

const MAX_FRET = 12;

const variant = (
  shape: ChordShape,
  frets: readonly (number | null)[],
  idSuffix: string,
  label: string,
  string: number | null,
  tuningId?: string,
): Hypothesis => {
  const mutated: ChordShape = {
    ...shape,
    id: `${shape.id}~${idSuffix}`,
    frets: toFretTuple(frets),
  };
  return { id: mutated.id, label, target: resolveShape(mutated, tuningId), string };
};

const sameNotes = (a: readonly MidiNote[], b: readonly MidiNote[]): boolean =>
  a.length === b.length && a.every((n, i) => n === b[i]);

/**
 * Enumerate the near misses for a shape: a finger a fret or two off, a finger not
 * pressing down, a finger accidentally damping a neighbour, or the whole shape slid
 * along the neck.
 *
 * Hypotheses that resolve to the target's own pitches are dropped — they aren't wrong,
 * they're the same sound, and keeping them would make the margin test unsatisfiable.
 */
export const confusionSet = (shape: ChordShape, tuningId?: string): readonly Hypothesis[] => {
  const target = resolveShape(shape, tuningId);
  const base: readonly (number | null)[] = shape.frets;
  const out: Hypothesis[] = [];

  base.forEach((f, i) => {
    // Finger on the wrong fret.
    for (const delta of [-2, -1, 1, 2]) {
      if (f === null) continue;
      const moved = f + delta;
      if (moved < 0 || moved > MAX_FRET) continue;
      const frets = [...base];
      frets[i] = moved;
      out.push(
        variant(
          shape,
          frets,
          `s${i}${delta > 0 ? '+' : ''}${delta}`,
          `string ${4 - i} ${Math.abs(delta)} fret${Math.abs(delta) > 1 ? 's' : ''} ${delta > 0 ? 'sharp' : 'flat'}`,
          i,
          tuningId,
        ),
      );
    }

    // Finger resting on the string without pressing it down.
    if (f !== null && f > 0) {
      const frets = [...base];
      frets[i] = 0;
      out.push(variant(shape, frets, `s${i}open`, `string ${4 - i} not pressed down`, i, tuningId));
    }

    // A neighbouring finger damping the string entirely.
    if (f !== null) {
      const frets = [...base];
      frets[i] = null;
      out.push(variant(shape, frets, `s${i}mute`, `string ${4 - i} muted`, i, tuningId));
    }
  });

  // Whole shape slid up or down the neck.
  for (const delta of [-1, 1]) {
    const frets = base.map((f) => (f === null || f === 0 ? f : f + delta));
    if (frets.some((f) => f !== null && (f < 0 || f > MAX_FRET))) continue;
    out.push(
      variant(
        shape,
        frets,
        `shift${delta > 0 ? '+' : ''}${delta}`,
        `whole shape one fret ${delta > 0 ? 'high' : 'low'}`,
        null,
        tuningId,
      ),
    );
  }

  const seen = new Set<string>();
  return out.filter((h) => {
    if (sameNotes(h.target.notes, target.notes)) return false;
    const key = h.target.notes.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
