import { describe, expect, it } from 'vitest';
import { atRisk, dayKey, displayStreak, EMPTY_STREAK, recordPractice } from '../src/srs/streak';

const d = (iso: string) => new Date(`${iso}T12:00:00`);

describe('streaks', () => {
  it('starts at one', () => {
    expect(recordPractice(EMPTY_STREAK, d('2026-03-01')).current).toBe(1);
  });

  it('extends across consecutive days', () => {
    let s = recordPractice(EMPTY_STREAK, d('2026-03-01'));
    s = recordPractice(s, d('2026-03-02'));
    s = recordPractice(s, d('2026-03-03'));
    expect(s.current).toBe(3);
  });

  it('does not double-count two sessions on the same day', () => {
    let s = recordPractice(EMPTY_STREAK, new Date('2026-03-01T09:00:00'));
    s = recordPractice(s, new Date('2026-03-01T21:00:00'));
    expect(s.current).toBe(1);
  });

  it('counts calendar days, not 24-hour periods', () => {
    // 11pm then 8am is two days of practice by any reasonable reading.
    let s = recordPractice(EMPTY_STREAK, new Date('2026-03-01T23:00:00'));
    s = recordPractice(s, new Date('2026-03-02T08:00:00'));
    expect(s.current).toBe(2);
  });

  it('resets after a missed day but remembers the best run', () => {
    let s = recordPractice(EMPTY_STREAK, d('2026-03-01'));
    s = recordPractice(s, d('2026-03-02'));
    s = recordPractice(s, d('2026-03-05'));
    expect(s.current).toBe(1);
    expect(s.longest).toBe(2);
  });

  it('still shows the streak on the day after, before it is broken', () => {
    const s = recordPractice(EMPTY_STREAK, d('2026-03-01'));
    expect(displayStreak(s, d('2026-03-02'))).toBe(1);
    expect(atRisk(s, d('2026-03-02'))).toBe(true);
  });

  it('shows zero once a day has actually been missed', () => {
    const s = recordPractice(EMPTY_STREAK, d('2026-03-01'));
    expect(displayStreak(s, d('2026-03-03'))).toBe(0);
    expect(atRisk(s, d('2026-03-03'))).toBe(false);
  });

  it('handles month and year boundaries', () => {
    let s = recordPractice(EMPTY_STREAK, d('2026-12-31'));
    s = recordPractice(s, d('2027-01-01'));
    expect(s.current).toBe(2);
    expect(dayKey(d('2027-01-01'))).toBe('2027-01-01');
  });
});
