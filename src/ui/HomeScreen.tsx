import { getShape } from '../music/shapes';
import type { Card, SessionSettings } from '../srs/types';
import { Scheduler } from '../srs/scheduler';
import { displayStreak, type StreakState } from '../srs/streak';

/** Chords shown as tiles. Beyond this the grid stops being scannable at arm's length. */
const MAX_TILES = 8;

const uniq = (ids: readonly string[]): string[] => [...new Set(ids)];

/**
 * Today.
 *
 * The screen answers one question — what is there to play right now — and then gets out of
 * the way. What's due and what's new are the two numbers, the chords themselves are the
 * evidence, and the only decision left is how long for.
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
  const due = cards.filter((c) => !Scheduler.isNew(c) && Scheduler.isDue(c, now));
  const seenShapes = new Set(cards.filter((c) => !Scheduler.isNew(c)).map((c) => c.shapeId));
  // A chord counts as new only if no presentation of it has ever been seen — a new
  // diagram card for a chord already drilled by name is a review, not a new chord.
  const newShapes = uniq(
    cards.filter((c) => Scheduler.isNew(c) && !seenShapes.has(c.shapeId)).map((c) => c.shapeId),
  ).slice(0, settings.newCardsPerDay);

  const dueShapes = uniq(due.map((c) => c.shapeId));
  const tiles = [
    ...dueShapes.map((id) => ({ id, isNew: false })),
    ...newShapes.map((id) => ({ id, isNew: true })),
  ].slice(0, MAX_TILES);

  const days = displayStreak(streak, now);
  const minPct = ((settings.targetMinutes - 5) / 15) * 100;

  return (
    <div className="app">
      <div className="row spread" style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0 }}>Today</h1>
        {days > 0 ? (
          <div className="count-pill" aria-label={`${days} day streak`}>
            {days}
          </div>
        ) : null}
      </div>

      <div className="tiles" style={{ marginBottom: 14 }}>
        <div className="tile">
          <div className="figure">{due.length}</div>
          <div className="label">to review</div>
        </div>
        <div className="tile accent">
          <div className="figure">{newShapes.length}</div>
          <div className="label">{newShapes.length === 1 ? 'new chord' : 'new chords'}</div>
        </div>
      </div>

      {tiles.length ? (
        <div className="chord-grid" style={{ marginBottom: 28 }}>
          {tiles.map((t) => (
            <div key={t.id} className={`chord-tile${t.isNew ? ' new' : ''}`}>
              {getShape(t.id).name}
              {t.isNew ? <span className="sr-only"> — new</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <p style={{ marginBottom: 28 }}>
          Nothing is due. Play anyway — practice never counts against you.
        </p>
      )}

      <div className="push-down">
        <div className="row" style={{ gap: 14, marginBottom: 18, flexWrap: 'nowrap' }}>
          <span className="muted" style={{ minWidth: 52 }}>
            {settings.targetMinutes} min
          </span>
          <div className="slider">
            <input
              type="range"
              min={5}
              max={20}
              step={1}
              value={settings.targetMinutes}
              aria-label="Session length in minutes"
              onChange={(e) => onSettings({ ...settings, targetMinutes: Number(e.target.value) })}
            />
            <div className="track" />
            <div className="fill" style={{ width: `${minPct}%` }} />
            <div className="knob" style={{ left: `${minPct}%` }} />
          </div>
        </div>

        <button className="primary" onClick={onStart} disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Starting…' : 'Play'}
        </button>

        {/* Quiet on purpose. Neither of these is part of practising, but both have to stay
            reachable — settings holds the tuning, and the detector page is the only way to
            tell "the app is broken" from "my microphone is". */}
        <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 18 }}>
          <button className="link" onClick={onOpenSettings}>
            Settings
          </button>
          <span className="muted" aria-hidden="true">
            ·
          </span>
          <button className="link" onClick={onDebug}>
            Detector
          </button>
        </div>
      </div>
    </div>
  );
}
