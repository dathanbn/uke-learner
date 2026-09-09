/**
 * Branded numeric types.
 *
 * MidiNote, Hz, Cents and FretNumber are all `number` at runtime and they *will*
 * get mixed up otherwise — passing a MIDI note where Hz was expected is silent and
 * produces a detector that is subtly, unfalsifiably wrong.
 */
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type MidiNote = Brand<number, 'MidiNote'>;
export type Hz = Brand<number, 'Hz'>;
export type Cents = Brand<number, 'Cents'>;
export type FretNumber = Brand<number, 'FretNumber'>;

export const midi = (n: number): MidiNote => n as MidiNote;
export const hz = (n: number): Hz => n as Hz;
export const cents = (n: number): Cents => n as Cents;
export const fret = (n: number): FretNumber => n as FretNumber;

/** Which physical string, indexed from the 4th (G on a standard uke) to the 1st (A). */
export type StringIndex = 0 | 1 | 2 | 3;
export const STRING_INDICES: readonly StringIndex[] = [0, 1, 2, 3];

export interface Tuning {
  id: string;
  label: string;
  /** Open-string pitches, low index = 4th string. Reentrant tunings are not ascending. */
  openNotes: readonly [MidiNote, MidiNote, MidiNote, MidiNote];
  /** True when the 4th string is not the lowest — i.e. there is no bass note to anchor on. */
  reentrant: boolean;
}

export interface ChordShape {
  id: string;
  name: string;
  tuningId: string;
  /** Fret per string; 0 = open, null = muted / not played. */
  frets: readonly [
    FretNumber | null,
    FretNumber | null,
    FretNumber | null,
    FretNumber | null,
  ];
  /** Suggested fretting fingers, for the diagram only. Never used by the detector. */
  fingers?: readonly (number | null)[];
  tier: number;
}

/**
 * A chord shape resolved to concrete pitches. This — not the chord *name* — is what
 * the detector scores against. See docs/DECISIONS.md #1 and #4.
 */
export interface TargetShape {
  shapeId: string;
  name: string;
  /** Sounding note per string; null where the string is muted. */
  perString: readonly (MidiNote | null)[];
  /** Distinct sounding pitches, ascending. Duplicates collapsed. */
  notes: readonly MidiNote[];
}

export type StringFault =
  | { kind: 'ok' }
  | { kind: 'wrong_fret'; expected: MidiNote; heard: MidiNote; fretDelta: number }
  | { kind: 'missing'; expected: MidiNote }
  | { kind: 'unexpected'; heard: MidiNote };

export interface StringDiagnosis {
  string: StringIndex;
  fault: StringFault;
}

export type Verdict =
  | { kind: 'correct'; confidence: number; runnerUp: string | null; margin: number }
  | {
      kind: 'incorrect';
      confidence: number;
      /** Best-scoring member of the confusion set — what they probably played. */
      bestAlternative: string | null;
      perString: readonly StringDiagnosis[];
    }
  | { kind: 'unclear'; reason: 'too_quiet' | 'no_onset' | 'ambiguous' };

/** Per-note salience across the instrument's range, indexed from CONFIG.range.lowNote. */
export interface Activation {
  readonly lowNote: MidiNote;
  /** Normalised so the strongest note is 1. */
  readonly values: Float32Array;
}
