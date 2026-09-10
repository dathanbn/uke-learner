import { getTuning } from '../music/tunings';
import { noteLetter } from '../music/pitch';
import type { ChordShape, StringDiagnosis } from '../types';

/**
 * The board is drawn in a fixed 300 × 400 coordinate space and scaled by `width`, so the
 * hero diagram on the session screen is exact and the small ones in a transition card are
 * the same drawing, shrunk.
 */
const BOARD = {
  viewW: 300,
  viewH: 400,
  plate: { x: 24, y: 26, w: 252, h: 336, r: 18 },
  nutY: 60,
  left: 40,
  right: 260,
  fretH: 76,
  frets: 3,
  openY: 42,
  labelY: 336,
} as const;

const stringX = (i: number): number =>
  BOARD.left + i * ((BOARD.right - BOARD.left) / 3);

/**
 * A chord diagram.
 *
 * Deliberately present even though the detector can't verify fingering: two fingerings that
 * produce the same notes are acoustically identical, so the audio teaches the sound and
 * this teaches the hand.
 *
 * With a `diagnosis` it also carries the wrong answer. Marking the offending string on the
 * board itself — red string, a cross where the note actually landed, a pulse on where it
 * should have been — puts the correction where the learner is already looking, which a line
 * of text under the card does not.
 */
export function ChordDiagram({
  shape,
  width = 300,
  diagnosis,
  tuningId,
  stringLabels = false,
}: {
  shape: ChordShape;
  /** Rendered width in px; height follows at 4:3. */
  width?: number;
  /** Per-string diagnosis from an incorrect verdict. */
  diagnosis?: readonly StringDiagnosis[];
  tuningId?: string;
  /** Open-string names under the board. Worth the room on the hero diagram only. */
  stringLabels?: boolean;
}) {
  const played = shape.frets.filter((f): f is NonNullable<typeof f> => f !== null);
  const maxFret = Math.max(0, ...played);
  // Shift the window up the neck for barre shapes so the dots stay on the board.
  const base =
    maxFret > BOARD.frets ? Math.min(...played.filter((f) => f > 0)) - 1 : 0;
  const fretY = (f: number): number => BOARD.nutY + (f - base - 0.5) * BOARD.fretH;

  const faultOf = (i: number) => diagnosis?.[i]?.fault;
  const openNotes = getTuning(tuningId ?? shape.tuningId).openNotes;

  return (
    <svg
      className="fretboard"
      width={width}
      height={(width * BOARD.viewH) / BOARD.viewW}
      viewBox={`0 0 ${BOARD.viewW} ${BOARD.viewH}`}
      role="img"
      aria-label={`${shape.name} chord: ${shape.frets
        .map((f, i) => `string ${4 - i} ${f === null ? 'muted' : f === 0 ? 'open' : `fret ${f}`}`)
        .join(', ')}`}
    >
      <rect
        className="plate"
        x={BOARD.plate.x}
        y={BOARD.plate.y}
        width={BOARD.plate.w}
        height={BOARD.plate.h}
        rx={BOARD.plate.r}
      />

      {base === 0 ? (
        <line
          className="nut"
          x1={BOARD.left}
          y1={BOARD.nutY}
          x2={BOARD.right}
          y2={BOARD.nutY}
          strokeWidth={7}
        />
      ) : (
        <text className="string-label" x={14} y={fretY(base + 1) + 6} fontSize={17}>
          {base + 1}
        </text>
      )}

      {Array.from({ length: BOARD.frets }, (_, i) => (
        <line
          key={`f${i}`}
          className="wire"
          x1={BOARD.left}
          y1={BOARD.nutY + (i + 1) * BOARD.fretH}
          x2={BOARD.right}
          y2={BOARD.nutY + (i + 1) * BOARD.fretH}
          strokeWidth={3}
        />
      ))}

      {shape.frets.map((_, i) => {
        const faulty = faultOf(i) !== undefined && faultOf(i)?.kind !== 'ok';
        return (
          <line
            key={`s${i}`}
            className={`string${faulty ? ' faulty' : ''}`}
            x1={stringX(i)}
            y1={BOARD.nutY}
            x2={stringX(i)}
            y2={BOARD.nutY + BOARD.frets * BOARD.fretH}
            strokeWidth={faulty ? 4 : 3}
          />
        );
      })}

      {shape.frets.map((f, i) => {
        const x = stringX(i);
        const fault = faultOf(i);
        const wrong = fault !== undefined && fault.kind !== 'ok';
        // With a diagnosis in hand, every string that isn't at fault was heard correctly —
        // filling those markers in green is what makes "only this one string" readable at
        // a glance rather than something to work out.
        const sounding = diagnosis !== undefined && !wrong;

        if (f === null) {
          return (
            <g key={i}>
              <line
                className="muted-x"
                x1={x - 8}
                y1={BOARD.openY - 8}
                x2={x + 8}
                y2={BOARD.openY + 8}
                strokeWidth={3}
              />
              <line
                className="muted-x"
                x1={x + 8}
                y1={BOARD.openY - 8}
                x2={x - 8}
                y2={BOARD.openY + 8}
                strokeWidth={3}
              />
            </g>
          );
        }
        if (f === 0) {
          return (
            <circle
              key={i}
              className={`open${sounding ? ' sounding' : ''}`}
              cx={x}
              cy={BOARD.openY}
              r={9}
              strokeWidth={3}
            />
          );
        }
        const y = fretY(f);
        return (
          <g key={i}>
            <circle className="dot" cx={x} cy={y} r={26} />
            {/* A pulse on the target, only on the string that went wrong: the ring says
                "here", and nothing else on the board is moving. */}
            {wrong ? <circle className="dot-ring" cx={x} cy={y} r={26} strokeWidth={3} /> : null}
            <text className="dot-label" x={x} y={y + 7} fontSize={20}>
              {f}
            </text>
          </g>
        );
      })}

      {/* Where the note actually landed. A cross on the board beats any sentence. */}
      {diagnosis?.map((d) => {
        const x = stringX(d.string);
        const expected = shape.frets[d.string];
        if (d.fault.kind === 'wrong_fret' && expected !== null && expected !== undefined) {
          const heardFret = expected + d.fault.fretDelta;
          if (heardFret < base || heardFret > base + BOARD.frets) return null;
          const y = heardFret === 0 ? BOARD.openY : fretY(heardFret);
          const r = heardFret === 0 ? 14 : 22;
          return (
            <g key={`h${d.string}`}>
              <circle className="heard" cx={x} cy={y} r={r} strokeWidth={4} />
              <line
                className="heard-x"
                x1={x - r * 0.64}
                y1={y - r * 0.64}
                x2={x + r * 0.64}
                y2={y + r * 0.64}
                strokeWidth={4}
              />
              <line
                className="heard-x"
                x1={x + r * 0.64}
                y1={y - r * 0.64}
                x2={x - r * 0.64}
                y2={y + r * 0.64}
                strokeWidth={4}
              />
            </g>
          );
        }
        if (d.fault.kind === 'missing') {
          // Nothing came off this string at all — mark it silent above the nut rather than
          // pointing at a fret, because there is no fret to point at.
          return (
            <g key={`h${d.string}`}>
              <line
                className="heard-x"
                x1={x - 9}
                y1={BOARD.openY - 9}
                x2={x + 9}
                y2={BOARD.openY + 9}
                strokeWidth={4}
              />
              <line
                className="heard-x"
                x1={x + 9}
                y1={BOARD.openY - 9}
                x2={x - 9}
                y2={BOARD.openY + 9}
                strokeWidth={4}
              />
            </g>
          );
        }
        return null;
      })}

      {stringLabels
        ? shape.frets.map((_, i) => {
            const fault = faultOf(i);
            const wrong = fault !== undefined && fault.kind !== 'ok';
            return (
              <text
                key={`l${i}`}
                className={`string-label${wrong ? ' faulty' : ''}`}
                x={stringX(i)}
                y={BOARD.labelY}
                fontSize={17}
              >
                {noteLetter(openNotes[i as 0 | 1 | 2 | 3])}
              </text>
            );
          })
        : null}
    </svg>
  );
}
