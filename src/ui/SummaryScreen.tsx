import { Rating } from 'ts-fsrs';
import { getShape } from '../music/shapes';
import { Scheduler } from '../srs/scheduler';
import type { Card, ReviewLog } from '../srs/types';

/**
 * Ends the session by pointing at music rather than at statistics.
 *
 * Spaced repetition consolidates recall; fluency needs volume and songs. The app is a
 * chord gym, not a teacher, and the most useful thing it can say at the end is "here is
 * what you can now go and play".
 */
const SONGS: { title: string; chords: string[] }[] = [
  { title: 'Riptide — Vance Joy', chords: ['Am', 'G', 'C', 'F'] },
  { title: "I'm Yours — Jason Mraz", chords: ['C', 'G', 'Am', 'F'] },
  { title: 'Stand By Me', chords: ['C', 'Am', 'F', 'G7'] },
  { title: 'Hey Soul Sister — Train', chords: ['C', 'G', 'Am', 'F'] },
  { title: 'Somewhere Over the Rainbow', chords: ['C', 'Em', 'Am', 'F', 'G'] },
  { title: 'Three Little Birds — Bob Marley', chords: ['C', 'F', 'G'] },
  { title: 'Twist and Shout', chords: ['C', 'F', 'G7'] },
];

export function SummaryScreen({
  logs,
  cards,
  onHome,
}: {
  logs: readonly ReviewLog[];
  cards: readonly Card[];
  onHome: () => void;
}) {
  const total = logs.length;
  const firstTry = logs.filter((l) => l.grade === Rating.Good || l.grade === Rating.Easy).length;
  const accuracy = total ? Math.round((firstTry / total) * 100) : 0;
  const overrides = logs.filter((l) => l.overridden).length;

  const tomorrow = new Date(Date.now() + 86_400_000);
  const dueTomorrow = cards.filter((c) => !Scheduler.isNew(c) && Scheduler.isDue(c, tomorrow)).length;

  const known = new Set(
    cards.filter((c) => !Scheduler.isNew(c)).map((c) => getShape(c.shapeId).name),
  );
  const playable = SONGS.filter((s) => s.chords.every((c) => known.has(c))).slice(0, 3);

  return (
    <div className="app">
      <h1>Nice session</h1>

      <div className="card">
        <div className="row spread">
          <div className="stack">
            <span className="muted">Cards</span>
            <strong style={{ fontSize: 26 }}>{total}</strong>
          </div>
          <div className="stack">
            <span className="muted">First try</span>
            <strong style={{ fontSize: 26 }}>{accuracy}%</strong>
          </div>
          <div className="stack">
            <span className="muted">Due tomorrow</span>
            <strong style={{ fontSize: 26 }}>{dueTomorrow}</strong>
          </div>
        </div>
      </div>

      {playable.length ? (
        <div className="card">
          <h2>You can play these now</h2>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {playable.map((s) => (
              <li key={s.title} style={{ color: 'var(--ink-soft)', marginBottom: 6 }}>
                <strong style={{ color: 'var(--ink)' }}>{s.title}</strong>{' '}
                <span className="muted">— {s.chords.join(' · ')}</span>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
            Drilling chords builds recall; playing songs builds everything else. Go and play
            one.
          </p>
        </div>
      ) : null}

      {overrides > 0 ? (
        <div className="banner warn">
          You had to override the detector {overrides} time{overrides > 1 ? 's' : ''}. That's
          a bug on our side, not yours — those are logged so the chords it mishears can be
          fixed.
        </div>
      ) : null}

      <button className="primary" onClick={onHome} style={{ width: '100%' }}>
        Done
      </button>
    </div>
  );
}
