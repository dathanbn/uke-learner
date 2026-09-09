import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { gradeFor } from '../src/srs/grading';
import {
  initialMachineState,
  machineReducer,
  type MachineState,
} from '../src/ui/useSessionMachine';
import type { Verdict } from '../src/types';

const T0 = 1_000_000;
const start = () => initialMachineState(T0);

const correct: Verdict = { kind: 'correct', confidence: 0.9, runnerUp: null, margin: 0.1 };
const incorrect: Verdict = {
  kind: 'incorrect',
  confidence: 0.4,
  bestAlternative: 'string 1 1 fret flat',
  perString: [],
};
const unclear: Verdict = { kind: 'unclear', reason: 'ambiguous' };
const tooQuiet: Verdict = { kind: 'unclear', reason: 'too_quiet' };

const play = (state: MachineState, verdict: Verdict, at = T0 + 1000) =>
  machineReducer(state, { type: 'verdict', verdict, now: at });

describe('card state machine', () => {
  it('grades a first-try success as one attempt', () => {
    const s = play(start(), correct, T0 + 1400);
    expect(s.phase).toBe('graded');
    expect(s.outcome).toMatchObject({ attempts: 1, msToCorrect: 1400, overridden: false });
    expect(gradeFor({ ...s.outcome!, fastThresholdMs: 2500 })).toBe(Rating.Easy);
  });

  it('gives a second chance before revealing anything', () => {
    const s = play(start(), incorrect);
    expect(s.phase).toBe('retry');
    expect(s.attempts).toBe(2);
    const done = play(s, correct);
    expect(done.phase).toBe('graded');
    expect(gradeFor({ ...done.outcome!, fastThresholdMs: 2500 })).toBe(Rating.Hard);
  });

  it('reveals the shape after two failures and grades Again', () => {
    let s = play(start(), incorrect);
    s = play(s, incorrect);
    expect(s.phase).toBe('reveal');
    expect(s.attempts).toBe(3);
    const done = play(s, correct);
    expect(gradeFor({ ...done.outcome!, fastThresholdMs: 2500 })).toBe(Rating.Again);
  });

  it('does not punish further mistakes once the answer is shown', () => {
    let s = play(start(), incorrect);
    s = play(s, incorrect);
    s = play(s, incorrect);
    s = play(s, incorrect);
    expect(s.phase).toBe('reveal');
    expect(s.attempts).toBe(3);
    expect(s.outcome).toBeNull();
  });

  it('never grades on an unclear reading', () => {
    let s = play(start(), unclear);
    expect(s.phase).toBe('prompt');
    expect(s.outcome).toBeNull();
    expect(s.attempts).toBe(1);
    s = play(s, unclear);
    expect(s.attempts).toBe(1);
    // And a later clean play still counts as first try.
    const done = play(s, correct, T0 + 900);
    expect(done.outcome!.attempts).toBe(1);
  });

  it('explains a too-quiet reading differently from an ambiguous one', () => {
    expect(play(start(), tooQuiet).message).toMatch(/louder/i);
    expect(play(start(), unclear).message).toMatch(/catch/i);
  });

  it('offers a way out after repeated unclear readings', () => {
    let s = start();
    for (let i = 0; i < 3; i++) s = play(s, unclear);
    expect(s.unclearCount).toBeGreaterThan(2);
    expect(s.message).toMatch(/tap below/i);
  });

  it('honours a manual override and flags it in the outcome', () => {
    let s = play(start(), incorrect);
    s = machineReducer(s, { type: 'override', now: T0 + 4000 });
    expect(s.phase).toBe('graded');
    expect(s.outcome).toMatchObject({ attempts: 2, overridden: true });
  });

  it('ignores verdicts arriving after a card is already graded', () => {
    const graded = play(start(), correct);
    // A chord ringing on after the verdict must not re-grade the card.
    expect(play(graded, incorrect)).toBe(graded);
  });

  it('resets cleanly for the next card', () => {
    let s = play(start(), incorrect);
    s = play(s, incorrect);
    const fresh = machineReducer(s, { type: 'newCard', now: T0 + 20_000 });
    expect(fresh).toEqual(initialMachineState(T0 + 20_000));
  });
});
