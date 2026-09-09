import { createEmptyCard, fsrs, generatorParameters, Rating, State, type FSRS, type Grade } from 'ts-fsrs';
import { getShape, shapesForTier } from '../music/shapes';
import { cardId, type Card, type PresentationType, type SessionSettings } from './types';

/**
 * The day-scale scheduler.
 *
 * FSRS via ts-fsrs, not SM-2 and not homegrown: it is what Anki itself defaults to now,
 * it is free and runs in the browser with no server, and it exposes target retention as a
 * user-facing knob. The novelty of this product is the *input* to the scheduler — a
 * microphone instead of a self-report button — not the scheduler.
 */
export class Scheduler {
  private engine: FSRS;

  constructor(requestRetention: number) {
    this.engine = fsrs(generatorParameters({ request_retention: requestRetention, enable_fuzz: true }));
  }

  setRetention(requestRetention: number): void {
    this.engine = fsrs(generatorParameters({ request_retention: requestRetention, enable_fuzz: true }));
  }

  newCard(shapeId: string, presentation: PresentationType, toShapeId?: string, now = new Date()): Card {
    return {
      id: cardId(shapeId, presentation, toShapeId),
      shapeId,
      ...(toShapeId ? { toShapeId } : {}),
      presentation,
      fsrs: createEmptyCard(now),
    };
  }

  /** Apply a grade and return the updated card. Does not mutate the input. */
  grade(card: Card, grade: Grade, now = new Date()): Card {
    const result = this.engine.next(card.fsrs, now, grade);
    return { ...card, fsrs: result.card };
  }

  /** Days until due, negative when overdue. */
  static overdueDays(card: Card, now = new Date()): number {
    return (card.fsrs.due.getTime() - now.getTime()) / 86_400_000;
  }

  static isDue(card: Card, now = new Date()): boolean {
    return card.fsrs.due.getTime() <= now.getTime();
  }

  static isNew(card: Card): boolean {
    return card.fsrs.state === State.New;
  }
}

/** The starter deck for a tier: name→play and diagram→play for each shape. */
export const buildDeck = (
  scheduler: Scheduler,
  settings: SessionSettings,
  now = new Date(),
): Card[] => {
  const cards: Card[] = [];
  for (const shape of shapesForTier(settings.maxTier)) {
    cards.push(scheduler.newCard(shape.id, 'diagram_to_play', undefined, now));
    cards.push(scheduler.newCard(shape.id, 'name_to_play', undefined, now));
  }
  return cards;
};

/**
 * Transition cards for pairs of chords the learner already knows.
 *
 * Gated on `knownShapeIds` rather than generated for the whole tier, for two reasons.
 * Being asked to change *between* two chords you can't yet form individually is
 * demoralising and teaches nothing. And the pair count is quadratic — the full Tier 2 set
 * is 90 cards, which would swamp every session with material the learner isn't ready for.
 *
 * These are the cards that make the product worth using past week one: holding a C is
 * easy, changing C to F in time is the thing that actually gates playing songs.
 */
export const buildTransitions = (
  scheduler: Scheduler,
  settings: SessionSettings,
  knownShapeIds: ReadonlySet<string>,
  now = new Date(),
): Card[] => {
  const shapes = shapesForTier(settings.maxTier).filter((s) => knownShapeIds.has(s.id));
  const cards: Card[] = [];
  for (const a of shapes) {
    for (const b of shapes) {
      if (a.id === b.id) continue;
      cards.push(scheduler.newCard(a.id, 'transition', b.id, now));
    }
  }
  return cards;
};

/**
 * A chord counts as "known" once the app is confident enough not to show it for a few
 * days. Earlier than that and transitions arrive while the shapes themselves are still
 * being learned.
 */
export const TRANSITION_UNLOCK_DAYS = 3;

export const knownShapes = (cards: readonly Card[]): Set<string> => {
  const byShape = new Map<string, boolean>();
  for (const c of cards) {
    if (c.presentation === 'transition') continue;
    const ok = !Scheduler.isNew(c) && c.fsrs.scheduled_days >= TRANSITION_UNLOCK_DAYS;
    byShape.set(c.shapeId, (byShape.get(c.shapeId) ?? true) && ok);
  }
  return new Set([...byShape].filter(([, ok]) => ok).map(([id]) => id));
};

export const shapeName = (card: Card): string =>
  card.toShapeId
    ? `${getShape(card.shapeId).name} → ${getShape(card.toShapeId).name}`
    : getShape(card.shapeId).name;

export { Rating, State };
export type { Grade };
