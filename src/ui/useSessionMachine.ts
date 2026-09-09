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

/**
 * Which half of a transition card is being played.
 *
 * Transition cards are the reason this exists. Nobody struggles to *hold* a C; everybody
 * struggles to get from C to F in time, and that is the skill that gates playing actual
 * songs. It is also the thing this interface can measure and a tap-to-grade flashcard app
 * fundamentally cannot: two onsets, and the gap between them.
 */
export type Leg = 'first' | 'second';

export interface MachineState {
  phase: Phase;
  /** For transition cards: which chord we're waiting for. Always 'first' otherwise. */
  leg: Leg;
  /** When the first chord of a transition landed, for measuring the change. */
  firstLandedAt: number | null;
  /** Gap between the two chords of a transition, in ms. */
  transitionMs: number | null;
  /** 1, 2 or 3 — feeds the grade directly. */
  attempts: number;
  /** Consecutive unclear readings on the current attempt. */
  unclearCount: number;
  startedAt: number;
  lastConfidence: number;
  /** Set once the phase reaches 'graded'; the session layer consumes it. */
  isTransition: boolean;
  outcome: {
    attempts: number;
    msToCorrect: number;
    confidence: number;
    overridden: boolean;
    transitionMs?: number;
  } | null;
  message: string | null;
}

export type Action =
  | { type: 'newCard'; now: number; isTransition?: boolean }
  | { type: 'verdict'; verdict: Verdict; now: number }
  | { type: 'override'; now: number };

export const MAX_UNCLEAR = 2;

/**
 * Verdicts arriving this soon after a card appears are ignored.
 *
 * The previous chord is still ringing when the next card loads, and a learner who strums
 * once more out of habit produces a verdict against a card they have not yet read. Without
 * this they are marked wrong on their first attempt before seeing the chord — which feels
 * like the app cheating, and is the fastest way to lose trust in the grading.
 *
 * Short enough that it can never swallow a real answer: nobody reads a chord name and
 * forms the shape in a third of a second.
 */
export const SETTLE_MS = 350;

export const initialMachineState = (now: number, isTransition = false): MachineState => ({
  phase: 'prompt',
  leg: 'first',
  firstLandedAt: null,
  transitionMs: null,
  isTransition,
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
      return initialMachineState(action.now, action.isTransition ?? false);

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
      // Still settling from the previous card — see SETTLE_MS.
      if (action.now - state.startedAt < SETTLE_MS) return state;

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
        // First half of a transition: hold, don't grade. What is being measured is the
        // *change*, so the card isn't finished until the second chord lands.
        if (state.isTransition && state.leg === 'first') {
          return {
            ...state,
            leg: 'second',
            firstLandedAt: action.now,
            unclearCount: 0,
            lastConfidence: v.confidence,
            message: null,
          };
        }
        const transitionMs =
          state.isTransition && state.firstLandedAt !== null
            ? action.now - state.firstLandedAt
            : null;
        return {
          ...state,
          phase: 'graded',
          lastConfidence: v.confidence,
          transitionMs,
          outcome: {
            attempts: state.attempts,
            // For a transition the thing being graded is the change, not the whole card.
            msToCorrect: transitionMs ?? action.now - state.startedAt,
            confidence: v.confidence,
            overridden: false,
            ...(transitionMs !== null ? { transitionMs } : {}),
          },
          message: null,
        };
      }

      // Incorrect. A fumbled second chord restarts the change from the top — the skill is
      // the whole move, and grading half of it would reward stopping in the middle.
      if (state.isTransition && state.leg === 'second') {
        const bumped =
          state.phase === 'prompt' ? 'retry' : state.phase === 'retry' ? 'reveal' : state.phase;
        return {
          ...state,
          phase: bumped,
          attempts: bumped === 'retry' ? 2 : bumped === 'reveal' ? 3 : state.attempts,
          leg: 'first',
          firstLandedAt: null,
          unclearCount: 0,
          lastConfidence: v.confidence,
          message: null,
        };
      }

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

  const newCard = useCallback(
    (isTransition = false) => dispatch({ type: 'newCard', now: Date.now(), isTransition }),
    [],
  );
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

/** What a screen reader should hear when the verdict changes. */
export const announce = (state: MachineState, chordName: string): string => {
  if (state.message) return state.message;
  if (state.isTransition && state.leg === 'second') return 'Now the second chord.';
  switch (state.phase) {
    case 'prompt':
      return `Play ${chordName}.`;
    case 'retry':
      return `Not quite. Try ${chordName} once more.`;
    case 'reveal':
      return `Here is ${chordName}. Play it as shown.`;
    case 'graded':
      return 'Correct.';
  }
};
