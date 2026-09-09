import { Rating, type Grade } from 'ts-fsrs';
import { gradeFor, SpeedModel } from './grading';
import { Scheduler } from './scheduler';
import type { Card, PresentationType, ReviewLog, SessionSettings } from './types';

/**
 * A practice session: which cards, in what order, for how long.
 *
 * Two layers of scheduling, because FSRS alone is the wrong tool for half the job. FSRS is
 * calibrated for declarative recall on a day scale; a beginner who fails an F chord needs
 * to see it again in ninety seconds, not tomorrow. So the day scheduler decides whether a
 * card appears at all, and a within-session learning queue decides how often it comes back
 * before the session ends.
 *
 * Only the grade from a card's FIRST presentation in a session feeds FSRS. Feeding it the
 * repeats would tell the memory model the card was reviewed five times today and corrupt
 * every interval it computes from then on.
 */

/** Positions (in cards from now) at which a lapsed card returns within the session. */
const LEARNING_STEPS = [3, 10] as const;

/** An Again card costs roughly this much more than a Good one — it gets replayed. */
const LAPSE_COST_MULTIPLIER = 3;

/** Reserve for lapses when filling the queue, since they are unpredictable. */
const HEADROOM = 0.15;

export interface SessionCard {
  card: Card;
  /** How many times it has been presented in this session. */
  presentations: number;
}

export interface SessionResult {
  cardId: string;
  grade: Grade;
  attempts: number;
  msToCorrect: number;
  confidence: number;
  overridden: boolean;
}

export interface SessionSnapshot {
  current: Card | null;
  reviewed: number;
  remaining: number;
  estimatedSecondsLeft: number;
  elapsedSeconds: number;
  /** Cards still in the learning queue — the session cannot cleanly end while >0. */
  inLearning: number;
}

export class Session {
  private queue: SessionCard[] = [];
  /** Cards waiting to reappear, keyed by the presentation count they come due at. */
  private learning: { card: Card; dueAtPresentation: number; presentations: number }[] = [];
  private index = 0;
  /**
   * Every presentation, lapses included. Learning steps count against this rather than
   * against the queue index: a lapse answer does not advance the queue, so scheduling a
   * repeat "3 cards from now" against the index makes it due immediately, forever. A card
   * the learner keeps failing then blocks the session and nothing else is ever shown.
   */
  private presentationCount = 0;
  private startedAt: number;
  private gradedThisSession = new Set<string>();
  readonly logs: ReviewLog[] = [];
  readonly updated = new Map<string, Card>();

  constructor(
    private readonly scheduler: Scheduler,
    private readonly settings: SessionSettings,
    private readonly speed: SpeedModel,
    /** Seconds per card, per presentation type, learned across sessions. */
    private readonly secondsPerCard: Map<PresentationType, number>,
    now = new Date(),
  ) {
    this.startedAt = now.getTime();
  }

  /**
   * Fill the queue to fit the target duration.
   *
   * Due cards first, ordered by overdueness, then new cards up to the daily cap. If due
   * cards alone overflow the budget that is fine — show the most overdue and say how many
   * are left. Never silently drop reviews.
   */
  plan(all: readonly Card[], newIntroducedToday: number, now = new Date()): void {
    const available = all.filter((c) => !c.suspended);
    const due = available
      .filter((c) => !Scheduler.isNew(c) && Scheduler.isDue(c, now))
      .sort((a, b) => Scheduler.overdueDays(a, now) - Scheduler.overdueDays(b, now));
    const fresh = available.filter((c) => Scheduler.isNew(c));

    const budgetSeconds = this.settings.targetMinutes * 60 * (1 - HEADROOM);
    const picked: Card[] = [];
    let spent = 0;

    for (const card of due) {
      const cost = this.costOf(card);
      if (spent + cost > budgetSeconds && picked.length > 0) break;
      picked.push(card);
      spent += cost;
    }

    const newAllowance = Math.max(0, this.settings.newCardsPerDay - newIntroducedToday);
    for (const card of fresh.slice(0, newAllowance)) {
      const cost = this.costOf(card) * LAPSE_COST_MULTIPLIER;
      if (spent + cost > budgetSeconds) break;
      picked.push(card);
      spent += cost;
    }

    this.queue = picked.map((card) => ({ card, presentations: 0 }));
    this.index = 0;
  }

  private costOf(card: Card): number {
    return this.secondsPerCard.get(card.presentation) ?? 8;
  }

  get current(): Card | null {
    // A learning card that has come due takes priority over the main queue.
    const readyLapse = this.learning.find((l) => l.dueAtPresentation <= this.presentationCount);
    if (readyLapse) return readyLapse.card;

    const next = this.queue[this.index]?.card;
    if (next) return next;

    // Queue exhausted but lapses outstanding: show the one due soonest rather than ending
    // the session with cards the learner never got right.
    if (this.learning.length > 0) {
      return this.learning.reduce((a, b) => (a.dueAtPresentation <= b.dueAtPresentation ? a : b))
        .card;
    }
    return null;
  }

  /**
   * Record an answer and advance.
   *
   * `overridden` marks a manual "I played that right" — it still grades, because the user
   * is the authority on what they played, but it is logged so a chord with a high override
   * rate shows up as the detector bug it is.
   */
  answer(
    outcome: {
      attempts: number;
      msToCorrect: number;
      confidence: number;
      overridden: boolean;
      transitionMs?: number;
    },
    now = new Date(),
  ): void {
    const card = this.current;
    if (!card) return;

    const grade = gradeFor({
      attempts: outcome.attempts,
      msToCorrect: outcome.msToCorrect,
      fastThresholdMs: this.speed.fastThresholdMs,
    });

    // Only a card's first presentation this session feeds the day-scale model.
    if (!this.gradedThisSession.has(card.id)) {
      this.gradedThisSession.add(card.id);
      this.updated.set(card.id, this.scheduler.grade(card, grade, now));
      this.logs.push({
        cardId: card.id,
        ts: now.getTime(),
        grade,
        attempts: outcome.attempts,
        msToCorrect: outcome.msToCorrect,
        confidence: outcome.confidence,
        overridden: outcome.overridden,
        ...(outcome.transitionMs !== undefined ? { transitionMs: outcome.transitionMs } : {}),
      });
      if (outcome.attempts === 1) this.speed.record(outcome.msToCorrect);
    }

    this.presentationCount++;
    const lapseIdx = this.learning.findIndex((l) => l.card.id === card.id);
    const wasLapse = lapseIdx >= 0;
    const presentations = wasLapse ? this.learning[lapseIdx]!.presentations : 0;
    if (wasLapse) this.learning.splice(lapseIdx, 1);

    const clean = grade !== Rating.Again && outcome.attempts === 1;
    if (!clean) {
      // Back into the learning queue. A card leaves only after one clean first-try
      // success — that is what makes a ten-minute session actually teach something.
      const step = LEARNING_STEPS[Math.min(presentations, LEARNING_STEPS.length - 1)]!;
      this.learning.push({
        card,
        dueAtPresentation: this.presentationCount + step,
        presentations: presentations + 1,
      });
    }

    if (!wasLapse) this.index++;
  }

  snapshot(now = new Date()): SessionSnapshot {
    const elapsed = (now.getTime() - this.startedAt) / 1000;
    const remaining = Math.max(0, this.queue.length - this.index) + this.learning.length;
    const perCard = this.speed.medianMs / 1000 || 8;
    const estimate =
      remaining * perCard + this.learning.length * perCard * (LAPSE_COST_MULTIPLIER - 1);
    return {
      current: this.current,
      reviewed: this.gradedThisSession.size,
      remaining,
      estimatedSecondsLeft: Math.max(0, estimate),
      elapsedSeconds: elapsed,
      inLearning: this.learning.length,
    };
  }

  /**
   * The session ends when the queue is empty, or the clock runs out AND nothing is left in
   * the learning queue.
   *
   * Never cut a session mid-lapse. Ending on a failure is the worst possible last
   * impression, and those are exactly the cards that most need the extra repetition.
   */
  isFinished(now = new Date()): boolean {
    if (this.current === null) return true;
    const overtime = (now.getTime() - this.startedAt) / 1000 >= this.settings.targetMinutes * 60;
    return overtime && this.learning.length === 0;
  }
}

/**
 * Smooths the estimated-time-remaining readout.
 *
 * A timer that jumps 3:20 → 4:10 reads as a bug even when it is more accurate, so the
 * displayed value is allowed to rise only slowly. It may fall freely — progress should
 * feel like progress.
 */
export class SmoothedEstimate {
  private shown: number | null = null;

  constructor(private readonly maxRiseSecondsPerUpdate = 2) {}

  update(actual: number): number {
    if (this.shown === null) this.shown = actual;
    else if (actual > this.shown) this.shown = Math.min(actual, this.shown + this.maxRiseSecondsPerUpdate);
    else this.shown = actual;
    return this.shown;
  }
}
