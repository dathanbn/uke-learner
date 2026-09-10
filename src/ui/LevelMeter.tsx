import { useEffect, useRef } from 'react';
import type { AudioEngine } from '../audio/engine';
import { CONFIG } from '../config';

/**
 * The live input level.
 *
 * The one piece of chrome that earns its place on a hands-free screen: it is the only way
 * a learner can tell "the app is listening and I'm too quiet" from "the app has stopped
 * working". It is driven by the real microphone RMS and by nothing else — the bars sit
 * still in a silent room on purpose.
 *
 * Bar heights are written straight to the DOM from an animation frame rather than through
 * state: at ~90 frames a second, re-rendering the session screen for a meter would be the
 * most expensive thing on the page.
 */
export function LevelBars({
  engine,
  count = 5,
  height = 44,
  className = '',
}: {
  engine: AudioEngine;
  count?: number;
  /** Bar height in px at full level. */
  height?: number;
  className?: string;
}) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const rms = useRef(0);
  const shown = useRef(CONFIG.meter.restingScale);

  useEffect(() => {
    engine.setHandlers({ onFrame: (f) => (rms.current = f.rms) });

    const { floorRms, fullRms, restingScale, attack, release } = CONFIG.meter;
    const span = Math.log(fullRms / floorRms);
    let frame = 0;

    const tick = () => {
      const heard = rms.current;
      const norm =
        heard <= floorRms ? 0 : Math.min(1, Math.max(0, Math.log(heard / floorRms) / span));
      const target = restingScale + (1 - restingScale) * norm;
      const rate = target > shown.current ? attack : release;
      shown.current += (target - shown.current) * rate;

      const mid = (count - 1) / 2;
      for (let i = 0; i < bars.current.length; i++) {
        const bar = bars.current[i];
        if (!bar) continue;
        // Taper the outer bars so the meter reads as a level rather than a bar chart.
        const weight = mid === 0 ? 1 : 1 - 0.38 * (Math.abs(i - mid) / mid);
        bar.style.transform = `scaleY(${Math.max(restingScale, shown.current * weight)})`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      engine.setHandlers({ onFrame: () => undefined });
    };
  }, [engine, count]);

  return (
    <div className={`level ${className}`.trim()} style={{ height }} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            bars.current[i] = el;
          }}
        />
      ))}
    </div>
  );
}

/**
 * The breathing halo the level sits inside. Slow enough to read as calm rather than as a
 * progress indicator — it says "waiting for you", not "working".
 */
export function ListeningHalo({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <div className="halo" style={{ width: size, height: size }}>
      <span className="ring" />
      <span className="ring inner" />
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  );
}
