import { useCallback, useReducer } from 'react';
import type { Verdict } from '../types';

/**
 * The card state machine.
 *
 * PROMPT ──correct──────────────► graded Good / Easy ──► next card
 *        └─incorrect─► RETRY ──correct──► graded Hard ──► next card
 *                            └─incorrect─► REVEAL ──correct──► graded Again ──► next card
 *
 * An `unclear` verdict never advances and never grades (CLAUDE.md invariant 5). It
 * re-prompts, at most twice, and then offers the manual override — because at that point
 * the problem is ours, not the learner's, and making them strum a fourth time to prove
 * themselves to a detector that isn't listening properly is how the app gets deleted.
 */

export type Phase = 'prompt' | 'retry' | 'reveal' | 'graded';

export interface MachineState {
  phase: Phase;
  /** 1, 2 or 3 — feeds the grade directly. */
  attempts: number;
  /** Consecutive unclear readings on the current attempt. */
  unclearCount: number;
  startedAt: number;
  lastConfidence: number;
  /** Set once the phase reaches 'graded'; the session layer consumes it. */
  outcome: { attempts: number; msToCorrect: number; confidence: number; overridden: boolean } | null;
  message: string | null;
}

export type Action =
  | { type: 'newCard'; now: number }
  | { type: 'verdict'; verdict: Verdict; now: number }
  | { type: 'override'; now: number };

export const MAX_UNCLEAR = 2;

export const initialMachineState = (now: number): MachineState => ({
  phase: 'prompt',
  attempts: 1,
  unclearCount: 0,
  startedAt: now,
  lastConfidence: 0,
  outcome: null,
  message: null,
});

export const machineReducer = (state: MachineState, action: Action): MachineState => {
  switch (action.type) {
    case 'newCard':
      return initialMachineState(action.now);

    case 'override':
      // The learner is the authority on what they played. Grade it as if the current
      // attempt succeeded, and flag it so a chord with a high override rate surfaces as
      // the detector bug it is.
      return {
        ...state,
        phase: 'graded',
        outcome: {
          attempts: state.attempts,
          msToCorrect: action.now - state.startedAt,
          confidence: state.lastConfidence,
          overridden: true,
        },
        message: null,
      };

    case 'verdict': {
      const v = action.verdict;
      if (state.phase === 'graded') return state;

      if (v.kind === 'unclear') {
        const count = state.unclearCount + 1;
        return {
          ...state,
          unclearCount: count,
          message:
            v.reason === 'too_quiet'
              ? 'Bit louder — I could barely hear that.'
              : count > MAX_UNCLEAR
                ? "I'm not hearing that clearly. Play it again, or tap below if you got it."
                : 'Didn’t quite catch that — once more.',
        };
      }

      if (v.kind === 'correct') {
        return {
          ...state,
          phase: 'graded',
          lastConfidence: v.confidence,
          outcome: {
            attempts: state.attempts,
            msToCorrect: action.now - state.startedAt,
            confidence: v.confidence,
            overridden: false,
          },
          message: null,
        };
      }

      // Incorrect.
      if (state.phase === 'prompt') {
        return { ...state, phase: 'retry', attempts: 2, unclearCount: 0, lastConfidence: v.confidence, message: null };
      }
      if (state.phase === 'retry') {
        return { ...state, phase: 'reveal', attempts: 3, unclearCount: 0, lastConfidence: v.confidence, message: null };
      }
      // Already revealed: stay here until they play it right. No penalty for trying.
      return { ...state, unclearCount: 0, lastConfidence: v.confidence, message: null };
    }
  }
};

export const useSessionMachine = () => {
  const [state, dispatch] = useReducer(machineReducer, Date.now(), initialMachineState);

  const newCard = useCallback(() => dispatch({ type: 'newCard', now: Date.now() }), []);
  const submitVerdict = useCallback(
    (verdict: Verdict) => dispatch({ type: 'verdict', verdict, now: Date.now() }),
    [],
  );
  const override = useCallback(() => dispatch({ type: 'override', now: Date.now() }), []);

  return {
    state,
    newCard,
    submitVerdict,
    override,
    /** Show the override button once the detector has failed us twice. */
    offerOverride: state.unclearCount > MAX_UNCLEAR,
  };
};
