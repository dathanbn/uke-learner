import {
  type ChordShape,
  type FretNumber,
  type MidiNote,
  type TargetShape,
  fret,
  midi,
} from '../types';
import { getTuning } from './tunings';

/** Widen a 4-element fret array into the tuple the ChordShape type requires. */
export const toFretTuple = (
  frets: readonly (number | null)[],
): readonly [FretNumber | null, FretNumber | null, FretNumber | null, FretNumber | null] => {
  if (frets.length !== 4) throw new Error(`Expected 4 frets, got ${frets.length}`);
  const [a, b, c, d] = frets.map((f) => (f === null ? null : fret(f)));
  return [a ?? null, b ?? null, c ?? null, d ?? null];
};

const s = (
  id: string,
  name: string,
  frets: readonly (number | null)[],
  tier: number,
  tuningId = 'high-g',
): ChordShape => ({
  id,
  name,
  tuningId,
  tier,
  frets: toFretTuple(frets),
});

/**
 * Tier 1 unlocks a genuinely large share of popular songs with four shapes, which is
 * why it is the default deck. Tiers 2+ follow docs/SCHEDULER.md.
 */
export const SHAPES: readonly ChordShape[] = [
  // Tier 1 — the first four
  s('C_0003', 'C', [0, 0, 0, 3], 1),
  s('Am_2000', 'Am', [2, 0, 0, 0], 1),
  s('F_2010', 'F', [2, 0, 1, 0], 1),
  s('G7_0212', 'G7', [0, 2, 1, 2], 1),

  // Tier 2 — open majors and minors
  s('G_0232', 'G', [0, 2, 3, 2], 2),
  s('D_2220', 'D', [2, 2, 2, 0], 2),
  s('A_2100', 'A', [2, 1, 0, 0], 2),
  s('Em_0432', 'Em', [0, 4, 3, 2], 2),
  s('Dm_2210', 'Dm', [2, 2, 1, 0], 2),
  s('E7_1202', 'E7', [1, 2, 0, 2], 2),

  // Tier 3 — sevenths
  s('C7_0001', 'C7', [0, 0, 0, 1], 3),
  s('D7_2223', 'D7', [2, 2, 2, 3], 3),
  s('A7_0100', 'A7', [0, 1, 0, 0], 3),
  s('B7_2322', 'B7', [2, 3, 2, 2], 3),
  s('G7alt_0212', 'G7', [0, 2, 1, 2], 3),

  // Tier 4 — barres, the wall most beginners hit
  s('Bb_3211', 'Bb', [3, 2, 1, 1], 4),
  s('B_4322', 'B', [4, 3, 2, 2], 4),
  s('Bm_4222', 'Bm', [4, 2, 2, 2], 4),
  s('Fm_1013', 'Fm', [1, 0, 1, 3], 4),

  // Tier 5 — colour
  s('Cmaj7_0002', 'Cmaj7', [0, 0, 0, 2], 5),
  s('Am7_0000', 'Am7', [0, 0, 0, 0], 5),
  s('Dsus4_0233', 'Dsus4', [0, 2, 3, 3], 5),
  s('Csus2_0233', 'Csus2', [0, 2, 3, 3], 5),
  s('Adim_2323', 'Adim', [2, 3, 2, 3], 5),
];

export const getShape = (id: string): ChordShape => {
  const shape = SHAPES.find((x) => x.id === id);
  if (!shape) throw new Error(`Unknown shape: ${id}`);
  return shape;
};

/** Resolve a shape against its tuning into the concrete pitches the detector targets. */
export const resolveShape = (shape: ChordShape): TargetShape => {
  const open = getTuning(shape.tuningId).openNotes;
  const perString = shape.frets.map((f, i) => {
    if (f === null) return null;
    const openNote = open[i];
    if (openNote === undefined) throw new Error(`Bad string index ${i}`);
    return midi(openNote + f);
  });
  const distinct = [...new Set(perString.filter((n): n is MidiNote => n !== null))].sort(
    (a, b) => a - b,
  );
  return { shapeId: shape.id, name: shape.name, perString, notes: distinct };
};

export const shapesForTier = (maxTier: number): readonly ChordShape[] =>
  SHAPES.filter((x) => x.tier <= maxTier);
