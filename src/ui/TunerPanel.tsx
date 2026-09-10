import type { CalibrationOutcome } from '../audio/calibration';
import { CONFIG } from '../config';
import { noteLetter } from '../music/pitch';
import { getTuning } from '../music/tunings';
import type { StringIndex } from '../types';

/** Cents shown either side of centre on a needle track. */
const SPAN = 50;

/** At most this many strings get a needle row — past two it stops being a nudge. */
const MAX_ROWS = 2;

interface StringState {
  string: StringIndex;
  note: string;
  /** Deviation with the global offset removed — the only part the player can fix. */
  rel: number | null;
  inTune: boolean;
}

/**
 * Tuner readout.
 *
 * Four dots and, when something is actually out, one red row per offending string. The
 * needle shows deviation *after* the global offset is removed, because that is the only
 * part the player can do anything about: an instrument uniformly 40 cents flat is in tune
 * with itself, and four needles pinned left would send them chasing a problem they don't
 * have.
 */
export function TunerPanel({
  outcome,
  onRecalibrate,
  onArpeggio,
  arpeggioNext,
  tuningId = 'high-g',
  listening,
  controls = true,
}: {
  outcome: CalibrationOutcome | null;
  onRecalibrate: () => void;
  /** Start (or cancel, with null) the guided one-string-at-a-time reading. */
  onArpeggio?: (start: boolean) => void;
  /** Which string the arpeggio is waiting for, when one is running. */
  arpeggioNext?: StringIndex | null;
  tuningId?: string;
  listening: boolean;
  /** Show the re-arm button. Off where the parent re-arms listening by itself. */
  controls?: boolean;
}) {
  const openNotes = getTuning(tuningId).openNotes;
  const arpeggioRunning = arpeggioNext !== undefined && arpeggioNext !== null;
  const offset = outcome && outcome.kind !== 'unusable' ? outcome.offsetCents : 0;
  // Offering the arpeggio only once the strum has actually struggled keeps the simple path
  // simple: a strum is one action and this is four.
  const suggestArpeggio =
    onArpeggio !== undefined && (outcome?.kind === 'unusable' || outcome?.kind === 'needs_tuning');

  const byString = new Map(outcome?.readings.map((r) => [r.string, r]) ?? []);
  const strings: StringState[] = ([0, 1, 2, 3] as StringIndex[]).map((i) => {
    const reading = byString.get(i);
    const rel =
      reading && reading.deviationCents !== null ? reading.deviationCents - offset : null;
    return {
      string: i,
      note: noteLetter(reading?.expected ?? openNotes[i]),
      rel,
      inTune: rel !== null && Math.abs(rel) < CONFIG.calibration.ignoreBelowCents,
    };
  });
  const off = strings.filter((s) => s.rel !== null && !s.inTune).slice(0, MAX_ROWS);

  return (
    <div style={{ width: '100%' }}>
      <div className="string-tiles">
        {strings.map((s) => (
          <div className="string-tile" key={s.string}>
            <div className="note">{s.note}</div>
            <div
              className={`dot ${s.rel === null ? 'unheard' : s.inTune ? 'ok' : 'off'}`}
              role="img"
              aria-label={`${s.note} string ${
                s.rel === null
                  ? 'not heard'
                  : s.inTune
                    ? 'in tune'
                    : `${Math.abs(Math.round(s.rel))} cents ${s.rel > 0 ? 'sharp' : 'flat'}`
              }`}
            />
          </div>
        ))}
      </div>

      {arpeggioRunning ? (
        <div className="banner ok" style={{ marginTop: 20, marginBottom: 0 }}>
          Play the <strong>{noteLetter(openNotes[arpeggioNext] ?? openNotes[0])}</strong> string on
          its own — one at a time reads far more precisely than a strum.
        </div>
      ) : (
        off.map((s) => {
          const rel = s.rel ?? 0;
          const pos = 50 + Math.max(-50, Math.min(50, (rel / SPAN) * 50));
          return (
            <div className="tuner-row" style={{ marginTop: 20 }} key={s.string}>
              <span className="note">{s.note}</span>
              <div className="track">
                <span className="centre" />
                <span className="needle" style={{ left: `${pos}%` }} />
              </div>
              {/* Flat sits left of centre and wants winding up; sharp is the mirror. The
                  arrow is the instruction — the number of cents would mean nothing to a
                  beginner and there is nowhere on a ukulele to dial it in. */}
              <span className="dir" aria-label={rel > 0 ? 'tune down' : 'tune up'}>
                {rel > 0 ? '↓' : '↑'}
              </span>
            </div>
          );
        })
      )}

      {outcome?.kind === 'unusable' && !arpeggioRunning ? (
        <div className="banner warn" style={{ marginTop: 20, marginBottom: 0 }}>
          {outcome.reason === 'no_signal'
            ? 'Strum all four, a little louder.'
            : 'More than a semitone out — tune roughly by ear first.'}
        </div>
      ) : null}

      {(suggestArpeggio && !arpeggioRunning) || arpeggioRunning || controls ? (
        <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 20 }}>
          {arpeggioRunning ? (
            <button className="link" onClick={() => onArpeggio?.(false)}>
              Cancel
            </button>
          ) : suggestArpeggio ? (
            <button className="link" onClick={() => onArpeggio?.(true)} disabled={!listening}>
              One string at a time
            </button>
          ) : null}
          {controls && !arpeggioRunning ? (
            <button className="link" onClick={onRecalibrate} disabled={!listening}>
              {outcome ? 'Check again' : 'Strum to calibrate'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
