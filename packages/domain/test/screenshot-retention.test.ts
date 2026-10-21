import { describe, expect, it } from 'vitest';
import { cleanupCutoff, isExpired, isMaterialRetentionChange, nextCleanupAt, parseRunAt, purgeRetryDelayMs } from '../src';

const daily = { frequency: 'DAILY' as const, runAt: '02:00', weekday: 0 };

describe('screenshot retention: cutoff and eligibility', () => {
  const run = new Date('2026-10-21T02:00:00Z');
  const cutoff = cleanupCutoff(run, 30);

  it('the cutoff is exactly 30 × 24 hours before the run started', () => {
    expect(cutoff.toISOString()).toBe('2026-09-21T02:00:00.000Z');
  });

  it('a screenshot older than 30 days is expired; a newer one is kept', () => {
    expect(isExpired(new Date('2026-09-10T09:00:00Z'), cutoff)).toBe(true);
    expect(isExpired(new Date('2026-10-01T09:00:00Z'), cutoff)).toBe(false);
  });

  it('a screenshot captured exactly at the cutoff is kept; a millisecond earlier is expired', () => {
    expect(isExpired(new Date(cutoff), cutoff)).toBe(false);
    expect(isExpired(new Date(cutoff.getTime() - 1), cutoff)).toBe(true);
  });
});

describe('screenshot retention: schedule', () => {
  it('runs at 02:00 in the configured time zone, not in UTC', () => {
    // 01:00 in Manila (UTC+8) on 21 Oct → next 02:00 Manila is 18:00 UTC on 20 Oct.
    expect(nextCleanupAt(new Date('2026-10-20T17:00:00Z'), daily, 'Asia/Manila').toISOString()).toBe('2026-10-20T18:00:00.000Z');
    // Just after today's run → tomorrow's.
    expect(nextCleanupAt(new Date('2026-10-20T18:00:00Z'), daily, 'Asia/Manila').toISOString()).toBe('2026-10-21T18:00:00.000Z');
    expect(nextCleanupAt(new Date('2026-10-21T01:59:00Z'), daily, 'UTC').toISOString()).toBe('2026-10-21T02:00:00.000Z');
  });

  it('a 02:00 run on the day clocks spring forward runs at the first valid time after', () => {
    // New York skips 02:00–03:00 on 8 March 2026: the run is at 03:00 EDT (07:00 UTC).
    expect(nextCleanupAt(new Date('2026-03-08T05:00:00Z'), daily, 'America/New_York').toISOString()).toBe('2026-03-08T07:00:00.000Z');
    // A normal day: 02:00 EST is 07:00 UTC, 02:00 EDT is 06:00 UTC.
    expect(nextCleanupAt(new Date('2026-03-01T00:00:00Z'), daily, 'America/New_York').toISOString()).toBe('2026-03-01T07:00:00.000Z');
    expect(nextCleanupAt(new Date('2026-03-10T00:00:00Z'), daily, 'America/New_York').toISOString()).toBe('2026-03-10T06:00:00.000Z');
  });

  it('weekly runs land on the chosen weekday', () => {
    // 21 Oct 2026 is a Wednesday; next Sunday is 25 Oct.
    const next = nextCleanupAt(new Date('2026-10-21T12:00:00Z'), { frequency: 'WEEKLY', runAt: '02:00', weekday: 0 }, 'UTC');
    expect(next.toISOString()).toBe('2026-10-25T02:00:00.000Z');
  });

  it('checks run times', () => {
    expect(parseRunAt('02:00')).toEqual({ hour: 2, minute: 0 });
    expect(parseRunAt('23:59')).toEqual({ hour: 23, minute: 59 });
    for (const bad of ['24:00', '2:00', '02:60', 'noon', '']) expect(parseRunAt(bad)).toBeNull();
    expect(() => nextCleanupAt(new Date(), { ...daily, runAt: '25:00' }, 'UTC')).toThrow();
  });
});

describe('screenshot retention: approval and retries', () => {
  it('only a shorter retention period is a material change', () => {
    expect(isMaterialRetentionChange(30, 14)).toBe(true);
    expect(isMaterialRetentionChange(30, 30)).toBe(false);
    expect(isMaterialRetentionChange(30, 90)).toBe(false);
  });

  it('retries back off and are capped at a day', () => {
    expect(purgeRetryDelayMs(1)).toBe(2 * 60_000);
    expect(purgeRetryDelayMs(3)).toBe(8 * 60_000);
    expect(purgeRetryDelayMs(30)).toBe(86_400_000);
  });
});
