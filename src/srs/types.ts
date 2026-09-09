import type { Card as FsrsCard, Grade } from 'ts-fsrs';

/**
 * A card is (chord shape, presentation type) — not just a chord. The same shape in
 * different presentations exercises different memories and schedules independently.
 */
export type PresentationType =
  /** "Play F" — recall the shape from the name. */
  | 'name_to_play'
  /** Shows the diagram — the training-wheels version. */
  | 'diagram_to_play'
  /** Plays the chord, you match it — ear training. */
  | 'ear_to_play'
  /** "C → G7" — the skill that actually gates playing songs. */
  | 'transition';

export const PRESENTATIONS: readonly PresentationType[] = [
  'name_to_play',
  'diagram_to_play',
  'ear_to_play',
  'transition',
];

export interface Card {
  id: string;
  shapeId: string;
  /** Second shape, for transition cards. */
  toShapeId?: string;
  presentation: PresentationType;
  fsrs: FsrsCard;
  /** Set when the user has suspended this card. */
  suspended?: boolean;
}

export const cardId = (
  shapeId: string,
  presentation: PresentationType,
  toShapeId?: string,
): string => (toShapeId ? `${shapeId}>${toShapeId}:${presentation}` : `${shapeId}:${presentation}`);

/**
 * Append-only. Never deleted or rewritten.
 *
 * This is what lets FSRS parameters be re-optimised against the user's own history later,
 * detector thresholds be retuned against real usage, and the scheduling algorithm be
 * replaced without losing anything. `overridden` doubles as a free bug tracker: a chord
 * with a high override rate is a detector bug, not a user problem.
 */
export interface ReviewLog {
  cardId: string;
  ts: number;
  grade: Grade;
  attempts: number;
  msToCorrect: number;
  confidence: number;
  overridden: boolean;
  /** True when this was the card's first ever review — drives the daily new-card cap. */
  wasNew: boolean;
  /** The learner declared they couldn't play this one yet, rather than getting it wrong. */
  setAside?: boolean;
  /** Milliseconds between the two chords, for transition cards. */
  transitionMs?: number;
}

export interface SessionSettings {
  targetMinutes: number;
  tuningId: string;
  /** Chord shapes are physically demanding in a way vocabulary is not — 20 new cards a
   *  day will wreck a beginner's hands. */
  newCardsPerDay: number;
  maxTier: number;
  /** Passed through to FSRS. Higher means shorter intervals and more reviews. */
  requestRetention: number;
  /**
   * Detector leniency. 1 is the tuned default. Raising it accepts more marginal playing,
   * which also means accepting more *wrong* playing — the expensive direction.
   */
  sensitivity: number;
}

export const DEFAULT_SETTINGS: SessionSettings = {
  targetMinutes: 10,
  tuningId: 'high-g',
  newCardsPerDay: 5,
  maxTier: 1,
  requestRetention: 0.9,
  sensitivity: 1,
};
