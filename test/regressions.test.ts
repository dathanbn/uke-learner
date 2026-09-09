import { describe, expect, it } from 'vitest';
import { Rating, State } from 'ts-fsrs';
import { SpeedModel } from '../src/srs/grading';
import { buildDeck, Scheduler } from '../src/srs/scheduler';
import { Session } from '../src/srs/session';
import { DEFAULT_SETTINGS, type PresentationType } from '../src/srs/types';

const settings = { ...DEFAULT_SETTINGS, maxTier: 1, targetMinutes: 10, newCardsPerDay: 5 };
const perCard = new Map<PresentationType, number>([
  ['name_to_play', 8],
  ['diagram_to_play', 8],
  ['ear_to_play', 10],
  ['transition', 12],
]);
const start = new Date('2026-01-01T09:00:00Z');
const mkSession = (over = settings) =>
  new Session(new Scheduler(0.9), over, new SpeedModel(2500), perCard, start);

describe('the UI needs a signal that changes on every presentation', () => {
  /**
   * The session screen resets the card state machine when the presented card changes.
   * Keying that off the card *id* freezes the app whenever the same card is presented
   * twice in a row, which happens at the end of every session that had a lapse: the queue
   * empties, one learning card is left, and answering it re-presents it. The id doesn't
   * change, so the machine never leaves the 'graded' phase and nothing advances again.
   */
  it('changes the presentation key even when the same card repeats', () => {
    const s = mkSession();
    s.plan(buildDeck(new Scheduler(0.9), settings), 0);

    // Fail everything so the queue drains into the learning queue.
    const keys: number[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 14 && s.current; i++) {
      keys.push(s.snapshot().presentationKey);
      ids.push(s.current.id);
      s.answer({ attempts: 3, msToCorrect: 9000, confidence: 0.4, overridden: false });
    }

    // The same card does get presented twice in a row once the queue is exhausted...
    let sawRepeat = false;
    for (let i = 1; i < ids.length; i++) if (ids[i] === ids[i - 1]) sawRepeat = true;
    expect(sawRepeat, 'expected a card to repeat back-to-back').toBe(true);

    // ...and the key must still advance, or the UI has nothing to react to.
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('new-card introduction is not confused with reviewing', () => {
  /**
   * The daily new-card cap counted every distinct card reviewed today, not the ones newly
   * introduced. Once a learner had a handful of due reviews, that alone consumed the whole
   * allowance and they would never be shown another new chord — the deck would silently
   * stop growing, forever.
   */
  it('marks only a card first seen today as newly introduced', () => {
    const scheduler = new Scheduler(0.9);
    const s = mkSession();
    const deck = buildDeck(scheduler, settings);

    // One card already has history; the rest are new.
    const reviewed = { ...deck[0]!, fsrs: scheduler.grade(deck[0]!, Rating.Good, start).fsrs };
    expect(reviewed.fsrs.state).not.toBe(State.New);

    s.plan([reviewed, ...deck.slice(1)], 0);
    while (s.current) {
      s.answer({ attempts: 1, msToCorrect: 2000, confidence: 0.9, overridden: false });
    }

    const introduced = s.logs.filter((l) => l.wasNew).length;
    const total = s.logs.length;
    expect(total).toBeGreaterThan(introduced);
    expect(introduced).toBeGreaterThan(0);
  });
});

describe('a chord the learner physically cannot play', () => {
  /**
   * The reveal phase only exits on a correct play. A beginner meeting their first barre
   * chord can be genuinely unable to produce it — and the manual override was only offered
   * after repeated *unclear* readings, which never happen when the detector can hear them
   * perfectly well playing it wrong. There has to be a way out that isn't "end the session".
   */
  it('can be set aside and graded Again', () => {
    const s = mkSession();
    s.plan(buildDeck(new Scheduler(0.9), settings), 0);
    const stuck = s.current!;
    s.setAside();
    expect(s.current?.id).not.toBe(stuck.id);
    const log = s.logs.find((l) => l.cardId === stuck.id);
    expect(log?.grade).toBe(Rating.Again);
    expect(log?.setAside).toBe(true);
  });

  it('does not bring a set-aside card back in the same session', () => {
    const s = mkSession();
    s.plan(buildDeck(new Scheduler(0.9), settings), 0);
    const stuck = s.current!;
    s.setAside();
    for (let i = 0; i < 12 && s.current; i++) {
      expect(s.current.id).not.toBe(stuck.id);
      s.answer({ attempts: 1, msToCorrect: 2000, confidence: 0.9, overridden: false });
    }
  });
});
