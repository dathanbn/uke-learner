import type { ChordShape } from '../types';

/**
 * A chord diagram. Deliberately present even though the detector can't verify fingering:
 * two fingerings that produce the same notes are acoustically identical, so the audio
 * teaches the sound and this teaches the hand.
 */
export function ChordDiagram({ shape, size = 132 }: { shape: ChordShape; size?: number }) {
  const strings = 4;
  const frets = 4;
  const padX = size * 0.18;
  const padTop = size * 0.22;
  const padBottom = size * 0.16;
  const w = size - padX * 2;
  const h = size - padTop - padBottom;
  const dx = w / (strings - 1);
  const dy = h / frets;

  const played = shape.frets.filter((f): f is NonNullable<typeof f> => f !== null);
  const maxFret = Math.max(0, ...played);
  // Shift the window up the neck for barre shapes so dots stay on the diagram.
  const base = maxFret > frets ? Math.min(...played.filter((f) => f > 0)) - 1 : 0;

  return (
    <svg
      className="fretboard"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${shape.name} chord: ${shape.frets
        .map((f, i) => `string ${4 - i} ${f === null ? 'muted' : f === 0 ? 'open' : `fret ${f}`}`)
        .join(', ')}`}
    >
      <text className="name" x={size / 2} y={padTop * 0.62}>
        {shape.name}
      </text>

      {base === 0 ? (
        <line className="nut" x1={padX} y1={padTop} x2={padX + w} y2={padTop} />
      ) : (
        <text className="dot-label" x={padX - 10} y={padTop + dy * 0.7} fill="var(--ink-faint)">
          {base + 1}
        </text>
      )}

      {Array.from({ length: frets + 1 }, (_, i) => (
        <line
          key={`f${i}`}
          className="wire"
          x1={padX}
          y1={padTop + i * dy}
          x2={padX + w}
          y2={padTop + i * dy}
        />
      ))}
      {Array.from({ length: strings }, (_, i) => (
        <line
          key={`s${i}`}
          className="string"
          x1={padX + i * dx}
          y1={padTop}
          x2={padX + i * dx}
          y2={padTop + h}
        />
      ))}

      {shape.frets.map((f, i) => {
        const x = padX + i * dx;
        if (f === null) {
          return (
            <g key={i}>
              <line className="muted-x" x1={x - 4} y1={padTop - 12} x2={x + 4} y2={padTop - 4} />
              <line className="muted-x" x1={x - 4} y1={padTop - 4} x2={x + 4} y2={padTop - 12} />
            </g>
          );
        }
        if (f === 0) {
          return <circle key={i} className="open" cx={x} cy={padTop - 8} r={4} />;
        }
        const y = padTop + (f - base - 0.5) * dy;
        const finger = shape.fingers?.[i];
        return (
          <g key={i}>
            <circle className="dot" cx={x} cy={y} r={dy * 0.34} />
            {finger ? (
              <text className="dot-label" x={x} y={y + 3.5}>
                {finger}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
