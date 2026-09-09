import { shapesForTier } from '../music/shapes';
import type { Card, SessionSettings } from '../srs/types';
import { Scheduler } from '../srs/scheduler';
import { atRisk, displayStreak, type StreakState } from '../srs/streak';

/**
 * The session length is a slider, not preset buttons, because the honest answer to "how
 * long should I practise" is "as long as you'll actually do today". The count of mastered
 * chords is shown against a *finite* total — "31 of 40" is far more motivating than an
 * endless deck, and on ukulele it is also true.
 */
export function HomeScreen({
  settings,
  cards,
  streak,
  onSettings,
  onStart,
  onDebug,
  onOpenSettings,
  busy,
}: {
  settings: SessionSettings;
  cards: readonly Card[];
  streak: StreakState;
  onSettings: (s: SessionSettings) => void;
  onStart: () => void;
  onDebug: () => void;
  onOpenSettings: () => void;
  busy: boolean;
}) {
  const now = new Date();
  const due = cards.filter((c) => !Scheduler.isNew(c) && Scheduler.isDue(c, now)).length;
  const seen = new Set(cards.filter((c) => !Scheduler.isNew(c)).map((c) => c.shapeId));
  const totalShapes = shapesForTier(settings.maxTier).length;
  // "Mastered" = the app is confident enough not to show it for a fortnight.
  const mastered = new Set(
    cards.filter((c) => c.fsrs.scheduled_days >= 14).map((c) => c.shapeId),
  ).size;
  const days = displayStreak(streak, now);
  const risky = atRisk(streak, now);

  return (
    <div className="app">
      <h1>Chord practice</h1>
      <p>
        Play the chord you're shown. The app listens and moves on by itself — you shouldn't
        need to touch the screen.
      </p>

      <div className="card">
        <div className="row spread" style={{ marginBottom: 18 }}>
          <div className="stack">
            <span className="muted">Chords started</span>
            <strong style={{ fontSize: 26 }}>
              {seen.size} <span className="muted" style={{ fontSize: 15 }}>/ {totalShapes}</span>
            </strong>
          </div>
          <div className="stack">
            <span className="muted">Mastered</span>
            <strong style={{ fontSize: 26 }}>{mastered}</strong>
          </div>
          <div className="stack">
            <span className="muted">Due now</span>
            <strong style={{ fontSize: 26 }}>{due}</strong>
          </div>
          <div className="stack">
            <span className="muted">Streak</span>
            <strong style={{ fontSize: 26 }}>
              {days} <span className="muted" style={{ fontSize: 15 }}>{days === 1 ? 'day' : 'days'}</span>
            </strong>
          </div>
        </div>

        {risky ? (
          <div className="banner warn" style={{ marginBottom: 14 }}>
            {days === 1 ? 'You practised yesterday' : `${days}-day streak`} — play today to keep
            it going.
          </div>
        ) : null}

        <label htmlFor="len" className="muted">
          Session length
        </label>
        <div className="row" style={{ marginTop: 6, marginBottom: 18 }}>
          <input
            id="len"
            type="range"
            min={5}
            max={20}
            step={1}
            value={settings.targetMinutes}
            onChange={(e) => onSettings({ ...settings, targetMinutes: Number(e.target.value) })}
            style={{ flex: 1 }}
          />
          <strong style={{ minWidth: 72, textAlign: 'right' }}>
            {settings.targetMinutes} min
          </strong>
        </div>

        <button className="primary" onClick={onStart} disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Starting…' : 'Start practising'}
        </button>
        <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
          You'll be asked for microphone access, then to strum once so the app can hear how
          your ukulele is tuned.
        </p>
      </div>

      <div className="card">
        <div className="row spread" style={{ marginBottom: 14 }}>
          <div className="stack">
            <strong>Settings</strong>
            <span className="muted">
              Tuning, how many new chords a day, listening sensitivity, your data.
            </span>
          </div>
          <button onClick={onOpenSettings}>Open</button>
        </div>
        <div className="row spread">
          <div className="stack">
            <strong>Detector debug</strong>
            <span className="muted">Live note readout, tuner and verdict internals.</span>
          </div>
          <button onClick={onDebug}>Open</button>
        </div>
      </div>
    </div>
  );
}
