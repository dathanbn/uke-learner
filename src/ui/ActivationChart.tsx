import { CONFIG } from '../config';
import { noteName } from '../music/pitch';
import { midi, type MidiNote } from '../types';

/**
 * Live note-activation readout.
 *
 * The single most useful thing on the debug page: an audio bug you cannot see is an audio
 * bug you cannot fix. Target notes are highlighted so a wrong string is visible at a
 * glance rather than inferred from a verdict.
 */
export function ActivationChart({
  activation,
  targetNotes,
}: {
  activation: Float32Array;
  targetNotes: readonly MidiNote[];
}) {
  const target = new Set<number>(targetNotes);
  const n = CONFIG.range.highNote - CONFIG.range.lowNote + 1;

  return (
    <div className="bars" role="img" aria-label="Note activation levels">
      {Array.from({ length: n }, (_, i) => {
        const note = midi(CONFIG.range.lowNote + i);
        const v = activation[i] ?? 0;
        const isTarget = target.has(note);
        const strong = v >= CONFIG.verdict.strongNoteFloor;
        const name = noteName(note);
        return (
          <div key={note} title={`${name} ${(v * 100).toFixed(0)}%`}>
            <div
              className={`bar ${isTarget ? 'target' : strong ? 'strong' : ''}`}
              style={{ height: `${Math.max(1, v * 100)}%` }}
            />
            <div className="tick">{name.startsWith('C') || isTarget ? name : ''}</div>
          </div>
        );
      })}
    </div>
  );
}
