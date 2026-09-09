/**
 * Practice streak.
 *
 * Stored rather than derived: deriving it means loading every review log the user has ever
 * written just to render one number on the home screen. It is also rebuildable from those
 * logs if it ever drifts, which is why the day strings are stored rather than a bare count.
 */
export interface StreakState {
  /** Local calendar day of the last completed session, as YYYY-MM-DD. */
  lastDay: string;
  current: number;
  longest: number;
}

export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const daysBetween = (a: string, b: string): number => {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000,
  );
};

export const EMPTY_STREAK: StreakState = { lastDay: '', current: 0, longest: 0 };

/**
 * Local calendar days, not 24-hour periods. Someone who practises at 11pm and then at 8am
 * has kept a two-day streak by any reasonable reading, and telling them otherwise is the
 * fastest way to make the number feel arbitrary.
 */
export const recordPractice = (state: StreakState, now = new Date()): StreakState => {
  const today = dayKey(now);
  if (state.lastDay === today) return state;

  const gap = state.lastDay ? daysBetween(state.lastDay, today) : Infinity;
  const current = gap === 1 ? state.current + 1 : 1;
  return { lastDay: today, current, longest: Math.max(state.longest, current) };
};

/** A streak shown on the home screen must not count days already missed. */
export const displayStreak = (state: StreakState, now = new Date()): number => {
  if (!state.lastDay) return 0;
  const gap = daysBetween(state.lastDay, dayKey(now));
  return gap <= 1 ? state.current : 0;
};

/** True when practising today would extend rather than restart the streak. */
export const atRisk = (state: StreakState, now = new Date()): boolean =>
  state.lastDay !== '' && daysBetween(state.lastDay, dayKey(now)) === 1 && state.current > 0;
