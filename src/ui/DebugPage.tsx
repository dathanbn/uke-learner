import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalibrationOutcome } from '../audio/calibration';
import { AudioEngine, type MicStatus, type VerdictUpdate } from '../audio/engine';
import { describeDiagnosis } from '../audio/verdict';
import { CONFIG } from '../config';
import { SHAPES, getShape, resolveShape } from '../music/shapes';
import { ActivationChart } from './ActivationChart';
import { ChordDiagram } from './ChordDiagram';
import { TunerPanel } from './TunerPanel';

const RANGE = CONFIG.range.highNote - CONFIG.range.lowNote + 1;

/**
 * The audio debug page.
 *
 * This exists before the card UI on purpose. If chord detection doesn't feel good, the
 * scheduler and the session flow are wasted work — so the first thing the project builds
 * is the thing that lets you stand there with a ukulele and find out.
 */
export function DebugPage() {
  const engineRef = useRef<AudioEngine | null>(null);
  const [status, setStatus] = useState<MicStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shapeId, setShapeId] = useState('C_0003');
  const [level, setLevel] = useState(0);
  const [activation, setActivation] = useState<Float32Array>(() => new Float32Array(RANGE));
  const [last, setLast] = useState<VerdictUpdate | null>(null);
  const [onsetFlash, setOnsetFlash] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [calibration, setCalibration] = useState<CalibrationOutcome | null>(null);

  const shape = useMemo(() => getShape(shapeId), [shapeId]);
  const target = useMemo(() => resolveShape(shape), [shape]);

  useEffect(() => {
    engineRef.current?.setTarget(shapeId);
  }, [shapeId]);

  const start = useCallback(async () => {
    setError(null);
    const engine = new AudioEngine();
    engineRef.current = engine;
    try {
      const s = await engine.start({
        onFrame: (f) => {
          setLevel(f.rms);
          setActivation(f.activation);
        },
        onOnset: () => setOnsetFlash(Date.now()),
        onCalibration: (o) => {
          setCalibration(o);
          // Move the detector's reference onto the instrument. Everything scored from here
          // is measured against how this ukulele is actually tuned, not against A440.
          if (o.kind === 'in_tune' || o.kind === 'auto_adjusted') {
            engine.setReferenceOffset(o.offsetCents);
          }
        },
        onVerdict: (v) => {
          setLast(v);
          setActivation(v.activation);
          setHistory((h) =>
            [`${new Date().toLocaleTimeString()} ${v.verdict.kind} (${v.targetConfidence.toFixed(3)})`, ...h].slice(0, 8),
          );
        },
      });
      setStatus(s);
      engine.setTarget(shapeId);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.name}: ${e.message}`
          : 'Could not open the microphone.',
      );
      engineRef.current = null;
    }
  }, [shapeId]);

  const stop = useCallback(async () => {
    await engineRef.current?.stop();
    engineRef.current = null;
    setStatus(null);
    setLast(null);
    setLevel(0);
    setActivation(new Float32Array(RANGE));
    setCalibration(null);
  }, []);

  const recalibrate = useCallback(() => {
    engineRef.current?.calibrate('high-g');
    setCalibration(null);
  }, []);

  useEffect(() => () => void engineRef.current?.stop(), []);

  const recentOnset = Date.now() - onsetFlash < 400;
  const v = last?.verdict;

  return (
    <div className="app">
      <div className="row spread" style={{ marginBottom: 16 }}>
        <div>
          <h1>Detector debug</h1>
          <p style={{ margin: 0 }}>
            Pick a chord, play it, and watch what the detector hears.
          </p>
        </div>
        {status ? (
          <button onClick={stop}>Stop listening</button>
        ) : (
          <button className="primary" onClick={start}>
            Start listening
          </button>
        )}
      </div>

      {error ? <div className="banner bad">{error}</div> : null}
      {status && !status.rawAudio ? (
        <div className="banner bad">
          The browser is applying voice processing to the microphone despite being asked not
          to. Echo cancellation and noise suppression are tuned for speech and will mangle
          the signal — detection will be unreliable. Try a different browser.
        </div>
      ) : null}
      {status?.warning ? <div className="banner warn">{status.warning}</div> : null}

      <TunerPanel outcome={calibration} onRecalibrate={recalibrate} listening={!!status} />

      <div className="card">
        <div className="row spread">
          <div className="row">
            <ChordDiagram shape={shape} />
            <div className="stack">
              <label className="muted" htmlFor="shape">
                Target chord
              </label>
              <select id="shape" value={shapeId} onChange={(e) => setShapeId(e.target.value)}>
                {SHAPES.filter((s) => s.tier <= 3).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.frets.map((f) => (f === null ? 'x' : f)).join('')}
                  </option>
                ))}
              </select>
              <span className="muted mono">
                {target.notes.map((n) => n).length} notes ·{' '}
                {target.perString.map((n) => (n === null ? 'x' : n)).join(' ')}
              </span>
            </div>
          </div>

          <div className="stack" style={{ minWidth: 220 }}>
            <span className="muted">Input level</span>
            <div className="meter">
              <i style={{ width: `${Math.min(100, level * 220)}%` }} />
            </div>
            <span className={`pill ${recentOnset ? 'ok' : ''}`}>
              {recentOnset ? '● strum detected' : '○ waiting for a strum'}
            </span>
            {status ? (
              <span className="muted mono">
                {status.deviceLabel} · raw audio {status.rawAudio ? 'on' : 'OFF'}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>What the detector heard</h2>
        <ActivationChart activation={activation} targetNotes={target.notes} />
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Orange bars are the notes this chord should produce. Anything else tall is either a
          wrong string or a harmonic the peeling stage failed to remove.
        </p>
      </div>

      <div className="card">
        <h2>Verdict</h2>
        {v ? (
          <>
            <div className={`verdict ${v.kind}`}>
              <span className="verdict-mark" aria-hidden="true">
                {v.kind === 'correct' ? '✓' : v.kind === 'incorrect' ? '✗' : '?'}
              </span>
              {v.kind === 'correct'
                ? 'Correct'
                : v.kind === 'incorrect'
                  ? 'Not quite'
                  : 'Didn’t catch that'}
            </div>

            {v.kind === 'incorrect' ? (
              <ul style={{ marginTop: 12, paddingLeft: 18 }}>
                {v.perString
                  .map(describeDiagnosis)
                  .filter((s): s is string => s !== null)
                  .map((s) => (
                    <li key={s} style={{ color: 'var(--ink-soft)', marginBottom: 4 }}>
                      {s}
                    </li>
                  ))}
                {v.bestAlternative ? (
                  <li style={{ color: 'var(--ink-faint)' }}>
                    Best match: {v.bestAlternative}
                  </li>
                ) : null}
              </ul>
            ) : null}

            {v.kind === 'unclear' ? (
              <p>
                {v.reason === 'too_quiet'
                  ? 'Too quiet to score — strum a bit harder.'
                  : 'Too close to call. Nothing is graded on an unclear reading; the card would simply be re-prompted.'}
              </p>
            ) : null}

            <div className="mono muted" style={{ marginTop: 8 }}>
              confidence {last!.targetConfidence.toFixed(3)} · verdict{' '}
              {last!.msFromOnset.toFixed(0)}ms after onset
            </div>
            <details style={{ marginTop: 10 }}>
              <summary className="muted">Closest alternatives</summary>
              <ul className="mono muted" style={{ paddingLeft: 18 }}>
                {last!.ranked.map((r) => (
                  <li key={r.id}>
                    {r.confidence.toFixed(3)} — {r.label}
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <p style={{ margin: 0 }}>Nothing yet. Start listening and strum the chord.</p>
        )}
      </div>

      {history.length ? (
        <div className="card">
          <h2>Recent</h2>
          <ul className="mono muted" style={{ paddingLeft: 18, margin: 0 }}>
            {history.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
