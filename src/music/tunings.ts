import { type MidiNote, type Tuning, midi } from '../types';

/**
 * Tunings are a data table, not constants, even though v1 ships ukulele only.
 * Costs nothing now; expensive to retrofit (docs/DECISIONS.md #6).
 */
export const TUNINGS: readonly Tuning[] = [
  {
    id: 'high-g',
    label: 'Standard (high G)',
    // G4 C4 E4 A4 — reentrant: the 4th string sounds *above* the 3rd, so a chord has
    // no bass note and voicing order carries no information. This is why chord
    // identification is ambiguous on ukulele and verification is not.
    openNotes: [midi(67), midi(60), midi(64), midi(69)],
    reentrant: true,
  },
  {
    id: 'low-g',
    label: 'Low G',
    openNotes: [midi(55), midi(60), midi(64), midi(69)],
    reentrant: false,
  },
  {
    id: 'baritone',
    label: 'Baritone (DGBE)',
    openNotes: [midi(50), midi(55), midi(59), midi(64)],
    reentrant: false,
  },
];

export const DEFAULT_TUNING_ID = 'high-g';

export const getTuning = (id: string): Tuning => {
  const t = TUNINGS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown tuning: ${id}`);
  return t;
};

export const openNotesOf = (id: string): readonly MidiNote[] => getTuning(id).openNotes;
