import { describe, expect, it } from 'vitest';
import { Rating, State } from 'ts-fsrs';
import { gradeFor, SpeedModel } from '../src/srs/grading';
import { buildDeck, Scheduler } from '../src/srs/scheduler';
import { Session, SmoothedEstimate } from '../src/srs/session';
import { DEFAULT_SETTINGS, type Card, type PresentationType } from '../src/srs/types';

const settings = { ...DEFAULT_SETTINGS, maxTier: 1, targetMinutes: 10, newCardsPerDay: 5 };
const perCard = new Map<PresentationType, number>([
  ['name_to_play', 8],
  ['diagram_to_play', 8],
  ['ear_to_play', 10],
  ['transition', 12],
]);

describe('grade mapping', () => {
  const fast = { fastThresholdMs: 2500 };
  it('grades a fast first-try answer as Easy', () => {
    expect(gradeFor({ attempts: 1, msToCorrect: 1400, ...fast })).toBe(Rating.Easy);
  });
  it('grades a slower first-try answer as Good', () => {
    expect(gradeFor({ attempts: 1, msToCorrect: 5200, ...fast })).toBe(Rating.Good);
  });
  it('grades a second-try answer as Hard', () => {
    expect(gradeFor({ attempts: 2, msToCorrect: 900, ...fast })).toBe(Rating.Hard);
  });
  it('grades a shown answer as Again regardless of speed', () => {
    expect(gradeFor({ attempts: 3, msToCorrect: 500, ...fast })).toBe(Rating.Again);
  });
});

describe('speed model', () => {
  it('falls back to the seed until it has enough samples', () => {
    const m = new SpeedModel(2500);
    m.record(900);
    expect(m.fastThresholdMs).toBe(2500);
  });

  it('adapts the "fast" threshold to the individual', () => {
    const slow = new SpeedModel(2500);
    for (const ms of [7000, 8000, 6500, 9000, 7500, 8200, 6800, 7900, 8400, 7100]) slow.record(ms);
    // A beginner answering in 7 seconds should still be able to earn an Easy.
    expect(slow.fastThresholdMs).toBeGreaterThan(2500);
    expect(gradeFor({ attempts: 1, msToCorrect: 6600, fastThresholdMs: slow.fastThresholdMs })).toBe(
      Rating.Easy,
    );
  });
});

describe('FSRS scheduling', () => {
  const scheduler = new Scheduler(0.9);

  it('creates new cards in the New state', () => {
    const c = scheduler.newCard('C_0003', 'name_to_play');
    expect(c.fsrs.state).toBe(State.New);
    expect(c.id).toBe('C_0003:name_to_play');
  });

  it('spreads intervals for a card answered well, repeatedly', () => {
    let card = scheduler.newCard('C_0003', 'name_to_play');
    let now = new Date('2026-01-01T09:00:00Z');
    const intervals: number[] = [];
    for (let i = 0; i < 6; i++) {
      card = scheduler.grade(card, Rating.Good, now);
      const days = (card.fsrs.due.getTime() - now.getTime()) / 86_400_000;
      intervals.push(days);
      now = new Date(card.fsrs.due);
    }
    // Later intervals must be substantially longer than the first ones.
    expect(intervals[intervals.length - 1]!).toBeGreaterThan(intervals[0]! * 3);
  });

  it('keeps bringing back a card that is repeatedly failed', () => {
    let good = scheduler.newCard('C_0003', 'name_to_play');
    let bad = scheduler.newCard('F_2010', 'name_to_play');
    let now = new Date('2026-01-01T09:00:00Z');
    for (let i = 0; i < 8; i++) {
      good = scheduler.grade(good, Rating.Good, now);
      bad = scheduler.grade(bad, Rating.Again, now);
      now = new Date(now.getTime() + 86_400_000);
    }
    expect(Scheduler.overdueDays(bad, now)).toBeLessThan(Scheduler.overdueDays(good, now));
  });

  it('shortens intervals when the user asks for higher retention', () => {
    const relaxed = new Scheduler(0.8);
    const strict = new Scheduler(0.97);
    const now = new Date('2026-01-01T09:00:00Z');
    const r = relaxed.grade(relaxed.newCard('C_0003', 'name_to_play'), Rating.Good, now);
    const s = strict.grade(strict.newCard('C_0003', 'name_to_play'), Rating.Good, now);
    expect(s.fsrs.due.getTime()).toBeLessThanOrEqual(r.fsrs.due.getTime());
  });
});

describe('session planning', () => {
  const scheduler = new Scheduler(0.9);

  const makeSession = (over = settings) =>
    new Session(scheduler, over, new SpeedModel(2500), perCard, new Date('2026-01-01T09:00:00Z'));

  it('builds a deck of two presentations per Tier 1 shape', () => {
    const deck = buildDeck(scheduler, settings);
    expect(deck).toHaveLength(8); // 4 chords x 2 presentations
    expect(new Set(deck.map((c) => c.id)).size).toBe(8);
  });

  it('respects the daily new-card cap', () => {
    const s = makeSession();
    s.plan(buildDeck(scheduler, settings), 0);
    let seen = 0;
    while (s.current && seen < 20) {
      s.answer({ attempts: 1, msToCorrect: 2000, confidence: 0.9, overridden: false });
      seen++;
    }
    expect(s.snapshot().reviewed).toBeLessThanOrEqual(settings.newCardsPerDay);
  });

  it('leaves no new cards when the cap is already spent', () => {
    const s = makeSession();
    s.plan(buildDeck(scheduler, settings), settings.newCardsPerDay);
    expect(s.current).toBeNull();
  });

  it('orders due cards by overdueness, most overdue first', () => {
    const now = new Date('2026-02-01T09:00:00Z');
    const mk = (id: string, daysOverdue: number): Card => {
      const c = scheduler.grade(scheduler.newCard(id, 'name_to_play'), Rating.Good, now);
      return { ...c, fsrs: { ...c.fsrs, due: new Date(now.getTime() - daysOverdue * 86_400_000) } };
    };
    const s = new Session(scheduler, settings, new SpeedModel(2500), perCard, now);
    s.plan([mk('C_0003', 1), mk('F_2010', 9), mk('Am_2000', 4)], 0, now);
    expect(s.current?.shapeId).toBe('F_2010');
  });

  it('fits roughly within the requested session length', () => {
    const many: Card[] = [];
    const base = new Date('2026-02-01T09:00:00Z');
    for (let i = 0; i < 200; i++) {
      const c = scheduler.grade(scheduler.newCard(`C_0003`, 'name_to_play'), Rating.Good, base);
      many.push({ ...c, id: `card-${i}`, fsrs: { ...c.fsrs, due: new Date(base.getTime() - 86_400_000) } });
    }
    const s = new Session(scheduler, { ...settings, targetMinutes: 10 }, new SpeedModel(2500), perCard, base);
    s.plan(many, 0, base);
    // 10 minutes at 8s/card, minus 15% headroom ≈ 63 cards.
    expect(s.snapshot().remaining).toBeGreaterThan(50);
    expect(s.snapshot().remaining).toBeLessThan(75);
  });
});

describe('within-session learning queue', () => {
  const scheduler = new Scheduler(0.9);
  const start = new Date('2026-01-01T09:00:00Z');

  it('brings a failed card back inside the same session', () => {
    const s = new Session(scheduler, settings, new SpeedModel(2500), perCard, start);
    s.plan(buildDeck(scheduler, settings), 0);
    const failed = s.current!;
    s.answer({ attempts: 3, msToCorrect: 9000, confidence: 0.4, overridden: false });

    let sawItAgain = false;
    for (let i = 0; i < 6 && s.current; i++) {
      if (s.current.id === failed.id) {
        sawItAgain = true;
        break;
      }
      s.answer({ attempts: 1, msToCorrect: 2000, confidence: 0.9, overridden: false });
    }
    expect(sawItAgain).toBe(true);
  });

  it('only lets the first presentation of a card feed FSRS', () => {
    const s = new Session(scheduler, settings, new SpeedModel(2500), perCard, start);
    s.plan(buildDeck(scheduler, settings), 0);
    const first = s.current!;
    s.answer({ attempts: 3, msToCorrect: 9000, confidence: 0.4, overridden: false });
    // Drive the card through its repeats.
    for (let i = 0; i < 8 && s.current; i++) {
      s.answer({ attempts: 1, msToCorrect: 1800, confidence: 0.95, overridden: false });
    }
    const logsForCard = s.logs.filter((l) => l.cardId === first.id);
    expect(logsForCard).toHaveLength(1);
    expect(logsForCard[0]!.grade).toBe(Rating.Again);
  });

  it('will not end while cards remain in the learning queue', () => {
    const s = new Session(scheduler, settings, new SpeedModel(2500), perCard, start);
    s.plan(buildDeck(scheduler, settings), 0);
    s.answer({ attempts: 3, msToCorrect: 9000, confidence: 0.4, overridden: false });
    // Well past the session clock: it still must not end on an unresolved failure.
    const later = new Date(start.getTime() + 20 * 60_000);
    expect(s.snapshot(later).inLearning).toBeGreaterThan(0);
    expect(s.isFinished(later)).toBe(false);
  });

  it('does not let a repeatedly failed card block the rest of the queue', () => {
    const s = new Session(scheduler, settings, new SpeedModel(2500), perCard, start);
    s.plan(buildDeck(scheduler, settings), 0);
    const stuck = s.current!;
    const seen = new Set<string>();
    for (let i = 0; i < 12 && s.current; i++) {
      seen.add(s.current.id);
      // Fail the first card every time it comes round; pass everything else.
      const failing = s.current.id === stuck.id;
      s.answer({
        attempts: failing ? 3 : 1,
        msToCorrect: failing ? 9000 : 1800,
        confidence: failing ? 0.4 : 0.95,
        overridden: false,
      });
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('records manual overrides so detector bugs are visible in the data', () => {
    const s = new Session(scheduler, settings, new SpeedModel(2500), perCard, start);
    s.plan(buildDeck(scheduler, settings), 0);
    s.answer({ attempts: 1, msToCorrect: 2000, confidence: 0.2, overridden: true });
    expect(s.logs[0]!.overridden).toBe(true);
  });
});

describe('estimated time remaining', () => {
  it('never jumps backwards by more than the smoothing allows', () => {
    const e = new SmoothedEstimate(2);
    e.update(100);
    expect(e.update(140)).toBe(102);
    expect(e.update(140)).toBe(104);
  });

  it('lets the estimate fall freely so progress feels like progress', () => {
    const e = new SmoothedEstimate(2);
    e.update(100);
    expect(e.update(60)).toBe(60);
  });
});

describe('90-day simulation', () => {
  it('spreads mastered chords and keeps drilling a problem chord', () => {
    const scheduler = new Scheduler(0.9);
    let cards = buildDeck(scheduler, settings);
    const speed = new SpeedModel(2500);
    let now = new Date('2026-01-01T09:00:00Z');
    let reviewsOfEasyChord = 0;
    let reviewsOfHardChord = 0;

    for (let day = 0; day < 90; day++) {
      const s = new Session(scheduler, settings, speed, perCard, now);
      s.plan(cards, 0, now);
      let guard = 0;
      while (s.current && !s.isFinished(now) && guard++ < 200) {
        const card = s.current;
        // F is the chord this simulated learner cannot play; everything else is fine.
        const isHard = card.shapeId === 'F_2010';
        if (card.presentation === 'name_to_play') {
          if (isHard) reviewsOfHardChord++;
          if (card.shapeId === 'C_0003') reviewsOfEasyChord++;
        }
        s.answer({
          attempts: isHard ? 3 : 1,
          msToCorrect: isHard ? 9000 : 1800,
          confidence: isHard ? 0.4 : 0.95,
          overridden: false,
        });
      }
      for (const [id, card] of s.updated) {
        cards = cards.map((c) => (c.id === id ? card : c));
      }
      now = new Date(now.getTime() + 86_400_000);
    }

    // The chord they keep failing should be drilled far more than the one they know.
    expect(reviewsOfHardChord).toBeGreaterThan(reviewsOfEasyChord * 2);
    // And the mastered chord should have stretched well past a daily interval.
    const easy = cards.find((c) => c.id === 'C_0003:name_to_play')!;
    expect(easy.fsrs.scheduled_days).toBeGreaterThan(7);
  });
});
