import { Rating } from 'ts-fsrs';
import { getShape } from '../music/shapes';
import { Scheduler } from '../srs/scheduler';
import type { Card, ReviewLog } from '../srs/types';
import { displayStreak, type StreakState } from '../srs/streak';

/**
 * Ends the session by pointing at music rather than at statistics.
 *
 * Spaced repetition consolidates recall; fluency needs volume and songs. The app is a
 * chord gym, not a teacher, and the most useful thing it can say at the end is "here is
 * what you can now go and play".
 */
const SONGS: { title: string; artist?: string; chords: string[] }[] = [
  { title: 'Riptide', artist: 'Vance Joy', chords: ['Am', 'G', 'C', 'F'] },
  { title: "I'm Yours", artist: 'Jason Mraz', chords: ['C', 'G', 'Am', 'F'] },
  { title: 'Stand By Me', chords: ['C', 'Am', 'F', 'G7'] },
  { title: 'Hey Soul Sister', artist: 'Train', chords: ['C', 'G', 'Am', 'F'] },
  { title: 'Somewhere Over the Rainbow', chords: ['C', 'Em', 'Am', 'F', 'G'] },
  { title: 'Three Little Birds', artist: 'Bob Marley', chords: ['C', 'F', 'G'] },
  { title: 'Twist and Shout', chords: ['C', 'F', 'G7'] },
];

export function SummaryScreen({
  logs,
  cards,
  streak,
  onHome,
}: {
  logs: readonly ReviewLog[];
  cards: readonly Card[];
  streak: StreakState;
  onHome: () => void;
}) {
  const total = logs.length;
  const firstTry = logs.filter((l) => l.grade === Rating.Good || l.grade === Rating.Easy).length;
  const accuracy = total ? Math.round((firstTry / total) * 100) : 0;
  const overrides = logs.filter((l) => l.overridden).length;
  const setAside = logs.filter((l) => l.setAside).length;
  const days = displayStreak(streak);

  const known = new Set(
    cards.filter((c) => !Scheduler.isNew(c)).map((c) => getShape(c.shapeId).name),
  );
  const playable = SONGS.filter((s) => s.chords.every((c) => known.has(c))).slice(0, 2);

  return (
    <div className="app">
      <h1 style={{ marginTop: 8, marginBottom: 26 }}>Done</h1>

      <div className="tiles" style={{ marginBottom: 14 }}>
        <div className="tile">
          <div className="figure">{total}</div>
          <div className="label">chords played</div>
        </div>
        <div className="tile accent">
          <div className="figure">{accuracy}%</div>
          <div className="label">first try</div>
        </div>
      </div>

      {days > 0 ? (
        <div
          className="row"
          style={{
            gap: 12,
            background: 'var(--accent-soft)',
            borderRadius: 'var(--radius)',
            padding: 18,
            marginBottom: 26,
            flexWrap: 'nowrap',
          }}
        >
          <span
            style={{ width: 12, height: 12, borderRadius: 999, background: 'var(--accent)' }}
            aria-hidden="true"
          />
          <span style={{ fontSize: 22, fontWeight: 500 }}>{days}</span>
          <span className="muted" style={{ color: 'var(--ink-soft)', fontSize: 15 }}>
            {days === 1 ? 'day' : 'days in a row'}
          </span>
        </div>
      ) : null}

      {playable.length ? (
        <>
          <div className="eyebrow">You can play</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {playable.map((s) => (
              <div className="card" style={{ marginBottom: 0 }} key={s.title}>
                <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
                  {s.title}
                  {s.artist ? (
                    <span className="muted" style={{ fontWeight: 500 }}>
                      {' '}
                      · {s.artist}
                    </span>
                  ) : null}
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {s.chords.map((c) => (
                    <span className="chip" key={c}>
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="push-down" style={{ paddingTop: 26 }}>
        {overrides > 0 ? (
          <div className="banner warn">
            The detector needed overriding {overrides} time{overrides > 1 ? 's' : ''} — that's a
            bug on our side, and those are logged so the chords it mishears can be fixed.
          </div>
        ) : null}

        {setAside > 0 ? (
          <div className="banner ok">
            You set {setAside} chord{setAside > 1 ? 's' : ''} aside. That's the right call —
            they'll come back tomorrow, and hands need time to build the shape.
          </div>
        ) : null}

        <button className="primary" onClick={onHome} style={{ width: '100%' }}>
          Done
        </button>
      </div>
    </div>
  );
}
