import type { CalibrationOutcome } from '../audio/calibration';
import { describeCalibration } from '../audio/calibration';
import { CONFIG } from '../config';
import { noteName } from '../music/pitch';

/**
 * Tuner readout.
 *
 * The needle shows each string's deviation *after* the global offset is removed, because
 * that is the only part the player can do anything about. An instrument uniformly 40 cents
 * flat is in tune with itself — showing four needles pinned to the left would tell them to
 * fix something that isn't broken.
 */
export function TunerPanel({
  outcome,
  onRecalibrate,
  listening,
}: {
  outcome: CalibrationOutcome | null;
  onRecalibrate: () => void;
  listening: boolean;
}) {
  const offset = outcome && outcome.kind !== 'unusable' ? outcome.offsetCents : 0;
  const span = 50; // cents shown either side of centre

  return (
    <div className="card">
      <div className="row spread" style={{ marginBottom: 12 }}>
        <div>
          <h2>Tuning</h2>
          <p style={{ margin: 0 }}>
            Strum all four strings once. Anything the instrument agrees with itself on gets
            absorbed automatically.
          </p>
        </div>
        <button onClick={onRecalibrate} disabled={!listening}>
          {outcome ? 'Check again' : 'Strum to calibrate'}
        </button>
      </div>

      {outcome ? (
        <div
          className={`banner ${
            outcome.kind === 'needs_tuning' || outcome.kind === 'unusable' ? 'warn' : 'ok'
          }`}
        >
          {describeCalibration(outcome)}
        </div>
      ) : null}

      {outcome && outcome.kind !== 'unusable'
        ? outcome.readings.map((r) => {
            const rel = r.deviationCents === null ? null : r.deviationCents - offset;
            const inTune = rel !== null && Math.abs(rel) < CONFIG.calibration.ignoreBelowCents;
            const pos = rel === null ? 50 : 50 + Math.max(-50, Math.min(50, (rel / span) * 50));
            return (
              <div className="tuner-row" key={r.string}>
                <strong>{noteName(r.expected)}</strong>
                <div
                  className="tuner-track"
                  role="img"
                  aria-label={
                    rel === null
                      ? `${noteName(r.expected)} string not heard`
                      : `${noteName(r.expected)} string ${Math.abs(Math.round(rel))} cents ${
                          rel > 0 ? 'sharp' : 'flat'
                        }`
                  }
                >
                  <div className="centre" />
                  <div
                    className={`needle ${inTune ? 'ok' : ''}`}
                    style={{ left: `calc(${pos}% - 3px)` }}
                  />
                </div>
                <span className="muted mono">
                  {rel === null
                    ? 'not heard'
                    : `${rel > 0 ? '+' : ''}${Math.round(rel)}¢${inTune ? ' ✓' : ''}`}
                </span>
              </div>
            );
          })
        : null}

      {outcome?.kind === 'auto_adjusted' ? (
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          The detector is now listening at {Math.abs(Math.round(outcome.offsetCents))} cents{' '}
          {outcome.offsetCents > 0 ? 'above' : 'below'} concert pitch, so you can practise
          without retuning. Chords are intervals — a uniform offset changes none of them.
        </p>
      ) : null}

      {outcome?.kind === 'needs_tuning' ? (
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          This part can’t be absorbed: the strings disagree with each other, so the chords
          themselves are wrong, not just their pitch. Practising through it would train your
          ear on the wrong intervals.
        </p>
      ) : null}
    </div>
  );
}
