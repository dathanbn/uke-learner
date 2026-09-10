import type { CalibrationOutcome } from '../audio/calibration';
import type { AudioEngine, MicStatus } from '../audio/engine';
import type { StringIndex } from '../types';
import { LevelBars, ListeningHalo } from './LevelMeter';
import { TunerPanel } from './TunerPanel';

/**
 * Strum to start.
 *
 * Tuning is not a step here, it is the way the session begins: one strum tells the app what
 * the instrument sounds like, and if the answer is "in tune" the first card is already on
 * its way. Nothing on this screen has to be tapped — the buttons exist for the two cases
 * that can't resolve themselves, an instrument that won't tune and a learner who wants to
 * get on with it anyway.
 */
export function TuneInScreen({
  engine,
  calibration,
  micStatus,
  arpeggioNext,
  tuningId,
  ready,
  onBack,
  onArpeggio,
  onStart,
}: {
  engine: AudioEngine | null;
  calibration: CalibrationOutcome | null;
  micStatus: MicStatus | null;
  arpeggioNext: StringIndex | null;
  tuningId: string;
  /** In tune, or in tune with itself and absorbed. */
  ready: boolean;
  onBack: () => void;
  onArpeggio: (start: boolean) => void;
  onStart: () => void;
}) {
  const heading = !calibration
    ? 'Strum once'
    : ready
      ? 'In tune'
      : calibration.kind === 'needs_tuning'
        ? `Tune ${calibration.corrections
            .slice(0, 2)
            .map((c) => c.note)
            .join(' · ')}`
        : 'Strum again';

  return (
    <div className="app">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="icon" onClick={onBack} aria-label="Back">
          ✕
        </button>
      </div>

      {micStatus && !micStatus.rawAudio ? (
        <div className="banner bad">
          Your browser is applying voice processing to the microphone despite being asked not
          to. It's tuned for speech and will mangle the sound of the instrument, so detection
          may be unreliable. Another browser will work better.
        </div>
      ) : null}
      {micStatus?.warning ? <div className="banner warn">{micStatus.warning}</div> : null}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ marginTop: 64 }}>
          <ListeningHalo size={236}>
            {engine ? <LevelBars engine={engine} count={4} height={76} /> : null}
          </ListeningHalo>
        </div>

        <div
          style={{
            marginTop: 52,
            marginBottom: 44,
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: '-0.015em',
          }}
        >
          {heading}
        </div>

        <TunerPanel
          outcome={calibration}
          listening
          controls={false}
          tuningId={tuningId}
          arpeggioNext={arpeggioNext}
          onArpeggio={onArpeggio}
          onRecalibrate={() => undefined}
        />
      </div>

      {/* An instrument that won't come into tune must never block practice (invariant 12).
          A cheap uke that cannot intonate, or a string that won't hold, is still better
          drilled on than locked out of. */}
      <div className="push-down" style={{ paddingTop: 26 }}>
        <button className={ready ? 'primary' : ''} onClick={onStart} style={{ width: '100%' }}>
          {ready ? 'Play' : 'Skip'}
        </button>
      </div>
    </div>
  );
}
