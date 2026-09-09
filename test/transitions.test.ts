import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { buildDeck, buildTransitions, knownShapes, Scheduler } from '../src/srs/scheduler';
import { DEFAULT_SETTINGS, type Card } from '../src/srs/types';
import { initialMachineState, machineReducer } from '../src/ui/useSessionMachine';
import type { Verdict } from '../src/types';

const settings = { ...DEFAULT_SETTINGS, maxTier: 1 };
const T0 = 1_000_000;
const correct: Verdict = { kind: 'correct', confidence: 0.9, runnerUp: null, margin: 0.1 };
const incorrect: Verdict = {
  kind: 'incorrect',
  confidence: 0.4,
  bestAlternative: null,
  perString: [],
};

const play = (state = initialMachineState(T0, true), verdict: Verdict, at = T0 + 1000) =>
  machineReducer(state, { type: 'verdict', verdict, now: at });

describe('transition unlocking', () => {
  const scheduler = new Scheduler(0.9);
  const now = new Date('2026-01-01T09:00:00Z');

  const mature = (card: Card, days: number): Card => ({
    ...card,
    fsrs: { ...scheduler.grade(card, Rating.Good, now).fsrs, scheduled_days: days },
  });

  it('offers nothing while the chords themselves are still being learned', () => {
    const deck = buildDeck(scheduler, settings, now);
    expect(buildTransitions(scheduler, settings, knownShapes(deck), now)).toHaveLength(0);
  });

  it('requires every presentation of a chord to be solid, not just one', () => {
    const deck = buildDeck(scheduler, settings, now);
    // Mature only the diagram card for C; the name card is still new.
    const partial = deck.map((c) =>
      c.id === 'C_0003:diagram_to_play' ? mature(c, 10) : c,
    );
    expect(knownShapes(partial).has('C_0003')).toBe(false);
  });

  it('unlocks pairs once two chords are both solid', () => {
    const deck = buildDeck(scheduler, settings, now);
    const solid = new Set(['C_0003', 'Am_2000']);
    const matured = deck.map((c) => (solid.has(c.shapeId) ? mature(c, 10) : c));
    const known = knownShapes(matured);
    expect(known).toEqual(solid);

    const pairs = buildTransitions(scheduler, settings, known, now);
    // Ordered pairs: C→Am and Am→C. Changing in each direction is a different move.
    expect(pairs.map((p) => p.id).sort()).toEqual([
      'Am_2000>C_0003:transition',
      'C_0003>Am_2000:transition',
    ]);
  });

  it('never pairs a chord with itself', () => {
    const known = new Set(['C_0003', 'Am_2000', 'F_2010']);
    const pairs = buildTransitions(scheduler, settings, known, now);
    expect(pairs.every((p) => p.shapeId !== p.toShapeId)).toBe(true);
    expect(pairs).toHaveLength(6); // 3 chords, ordered pairs
  });
});

describe('transition card state machine', () => {
  it('does not grade on the first chord alone', () => {
    const s = play(undefined, correct);
    expect(s.phase).toBe('prompt');
    expect(s.leg).toBe('second');
    expect(s.outcome).toBeNull();
  });

  it('grades on the change and measures how long it took', () => {
    let s = play(undefined, correct, T0 + 800);
    s = play(s, correct, T0 + 1900);
    expect(s.phase).toBe('graded');
    // 1100ms between the two chords — the change, not the whole card.
    expect(s.transitionMs).toBe(1100);
    expect(s.outcome).toMatchObject({ attempts: 1, msToCorrect: 1100, transitionMs: 1100 });
  });

  it('restarts the change when the second chord is fumbled', () => {
    let s = play(undefined, correct, T0 + 800);
    expect(s.leg).toBe('second');
    s = play(s, incorrect, T0 + 1500);
    // Back to the top: the skill is the whole move, and grading half of it would reward
    // stopping in the middle.
    expect(s.leg).toBe('first');
    expect(s.firstLandedAt).toBeNull();
    expect(s.phase).toBe('retry');
    expect(s.attempts).toBe(2);
  });

  it('reveals both chords after two failed changes', () => {
    let s = play(undefined, correct, T0 + 500);
    s = play(s, incorrect, T0 + 1200);
    s = play(s, correct, T0 + 1800);
    s = play(s, incorrect, T0 + 2400);
    expect(s.phase).toBe('reveal');
    expect(s.attempts).toBe(3);
  });

  it('is unaffected on a normal card', () => {
    const s = machineReducer(initialMachineState(T0, false), {
      type: 'verdict',
      verdict: correct,
      now: T0 + 1000,
    });
    expect(s.phase).toBe('graded');
    expect(s.transitionMs).toBeNull();
    expect(s.outcome).not.toHaveProperty('transitionMs');
  });
});
