import { CONFIG } from '../config';
import { type Cents, type Hz, type MidiNote, cents, hz, midi } from '../types';

/**
 * The reference pitch the detector is currently working against.
 *
 * This is the whole answer to "can tuning be automatic?". A ukulele sitting 40 cents
 * flat is perfectly in tune *with itself* — every interval, and therefore every chord,
 * is correct; only the absolute reference moved. So we move our reference to match,
 * rather than making the user chase A440 before they're allowed to practise.
 *
 * What this canNOT absorb is per-string error. See calibration.ts.
 */
export interface PitchReference {
  a4Hz: Hz;
}

export const CONCERT: PitchReference = { a4Hz: hz(CONFIG.reference.a4Hz) };

export const referenceFromOffset = (offsetCents: Cents): PitchReference => ({
  a4Hz: hz(CONFIG.reference.a4Hz * Math.pow(2, offsetCents / 1200)),
});

/** Cents by which a reference sits above (+) or below (-) concert pitch. */
export const referenceOffsetCents = (ref: PitchReference): Cents =>
  cents(1200 * Math.log2(ref.a4Hz / CONFIG.reference.a4Hz));

export const midiToHz = (note: MidiNote, ref: PitchReference = CONCERT): Hz =>
  hz(ref.a4Hz * Math.pow(2, (note - 69) / 12));

export const hzToMidi = (f: Hz, ref: PitchReference = CONCERT): number =>
  69 + 12 * Math.log2(f / ref.a4Hz);

export const centsBetween = (a: Hz, b: Hz): Cents => cents(1200 * Math.log2(a / b));

export const shiftCents = (f: Hz, c: Cents): Hz => hz(f * Math.pow(2, c / 1200));

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export const noteName = (note: MidiNote): string => {
  const pc = ((note % 12) + 12) % 12;
  return `${NAMES[pc]}${Math.floor(note / 12) - 1}`;
};

export const pitchClass = (note: MidiNote): number => ((note % 12) + 12) % 12;

/** Sounding pitch of a string stopped at a fret. */
export const frettedNote = (openNote: MidiNote, fretNumber: number): MidiNote =>
  midi(openNote + fretNumber);
