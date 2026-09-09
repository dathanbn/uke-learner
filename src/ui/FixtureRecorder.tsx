import { useCallback, useState } from 'react';
import type { AudioEngine } from '../audio/engine';
import { encodeWav } from '../audio/wav';
import { confusionSet } from '../music/confusion';
import { getShape } from '../music/shapes';

/**
 * Records labelled takes for `test/fixtures/`.
 *
 * The single most useful thing in this app for whoever is building it. Every accuracy
 * number in the repo comes from synthesised audio, and the only way to find out what a
 * real room, a real instrument and a real microphone do to the detector is to capture
 * them. Making that a two-click job rather than a chore with an audio editor is the
 * difference between a corpus that exists and one that doesn't.
 *
 * Filenames follow the convention the harness globs for, so recorded files can be dropped
 * straight into the repo.
 */
export function FixtureRecorder({
  engine,
  shapeId,
  tuningId,
  listening,
}: {
  engine: AudioEngine | null;
  shapeId: string;
  tuningId: string;
  listening: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [variant, setVariant] = useState('correct');
  const [take, setTake] = useState(1);
  const [saved, setSaved] = useState<string[]>([]);

  const shape = getShape(shapeId);
  // The wrong-take labels come from the same generator the detector scores against, so a
  // recorded mistake lines up with the hypothesis it is meant to exercise.
  const variants = ['correct', ...confusionSet(shape, tuningId).map((h) => h.label)];

  const start = useCallback(() => {
    engine?.startRecording();
    setRecording(true);
  }, [engine]);

  const stop = useCallback(() => {
    if (!engine) return;
    const { samples, sampleRate } = engine.stopRecording();
    setRecording(false);
    if (samples.length === 0) return;

    const slug = variant
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const name = `${shape.name.replace(/[^A-Za-z0-9#]/g, '')}_${
      variant === 'correct' ? 'correct' : `wrong-${slug}`
    }_${String(take).padStart(2, '0')}.wav`;

    const url = URL.createObjectURL(encodeWav(samples, sampleRate));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);

    setSaved((s) => [`${tuningId}/${name} — ${(samples.length / sampleRate).toFixed(1)}s`, ...s].slice(0, 8));
    setTake((t) => t + 1);
  }, [engine, shape.name, variant, take, tuningId]);

  return (
    <div className="card">
      <h2>Record a fixture</h2>
      <p>
        Capture what your actual ukulele sounds like, in your actual room. Files download
        with the name the test harness expects — drop them into{' '}
        <code className="mono">test/fixtures/{tuningId}/</code> and{' '}
        <code className="mono">npm run test:audio</code> will score them.
      </p>

      <div className="row" style={{ marginBottom: 12 }}>
        <div className="stack" style={{ flex: 1, minWidth: 220 }}>
          <label className="muted" htmlFor="variant">
            What you're about to play
          </label>
          <select id="variant" value={variant} onChange={(e) => setVariant(e.target.value)}>
            {variants.map((v) => (
              <option key={v} value={v}>
                {v === 'correct' ? `${shape.name} — correct` : `${shape.name} — ${v}`}
              </option>
            ))}
          </select>
        </div>
        <div className="stack" style={{ width: 90 }}>
          <label className="muted" htmlFor="take">
            Take
          </label>
          <input
            id="take"
            type="number"
            min={1}
            value={take}
            onChange={(e) => setTake(Number(e.target.value))}
            style={{ padding: 9, borderRadius: 14, border: '1px solid var(--line)', font: 'inherit' }}
          />
        </div>
      </div>

      <div className="row">
        {recording ? (
          <button className="primary" onClick={stop}>
            ■ Stop and save
          </button>
        ) : (
          <button onClick={start} disabled={!listening}>
            ● Record
          </button>
        )}
        {!listening ? <span className="muted">Start listening first.</span> : null}
        {recording ? <span className="pill warn">recording…</span> : null}
      </div>

      <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
        Two or three correct takes per chord, plus the mistakes you actually make. Record
        some from across the room, and some on a phone — awkward takes are the valuable ones.
      </p>

      {saved.length ? (
        <ul className="mono muted" style={{ paddingLeft: 18, marginTop: 12, marginBottom: 0 }}>
          {saved.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
