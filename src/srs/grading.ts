import { Rating, type Grade } from 'ts-fsrs';

/**
 * Turning behaviour into a grade.
 *
 * The core of this product: the grade is *measured*, not self-reported. Anki's weakest
 * link is that users lie to themselves about whether they knew it; playing a chord is
 * objectively verifiable.
 */

export interface Attempt {
  /** 1 = right first time, 2 = right on the retry, 3 = needed the answer shown. */
  attempts: number;
  /** From the card appearing to the correct play. */
  msToCorrect: number;
  /** Threshold below which a first-try answer counts as fluent, not merely correct. */
  fastThresholdMs: number;
}

/**
 * | What happened                         | Grade |
 * |---------------------------------------|-------|
 * | Correct first try, under the threshold| Easy  |
 * | Correct first try                     | Good  |
 * | Correct on the second try             | Hard  |
 * | Needed the shape shown                | Again |
 *
 * The spec only defines three outcomes. Reclaiming the fourth from time-to-correct is
 * free — we already measure it — and it rewards the thing the app exists to build:
 * fluency, not merely accuracy.
 */
export const gradeFor = (a: Attempt): Grade => {
  if (a.attempts >= 3) return Rating.Again;
  if (a.attempts === 2) return Rating.Hard;
  return a.msToCorrect <= a.fastThresholdMs ? Rating.Easy : Rating.Good;
};

/**
 * Rolling answer-speed estimator, used to set the "fast" threshold per user.
 *
 * A fixed constant would call a slow beginner never-fluent and a quick intermediate
 * always-fluent. Tracking the user's own lower quartile makes Easy mean "fast *for you*",
 * which is what keeps it meaningful as they improve.
 */
export class SpeedModel {
  private samples: number[] = [];

  constructor(
    private readonly seedMs = 2500,
    private readonly capacity = 60,
  ) {}

  record(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  /** Lower quartile of recent first-try answers, falling back to the seed. */
  get fastThresholdMs(): number {
    if (this.samples.length < 8) return this.seedMs;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.25)]!;
  }

  get medianMs(): number {
    if (this.samples.length === 0) return this.seedMs * 2;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  }

  toJSON(): number[] {
    return [...this.samples];
  }

  static fromJSON(samples: readonly number[], seedMs?: number): SpeedModel {
    const m = new SpeedModel(seedMs);
    for (const s of samples) m.record(s);
    return m;
  }
}
