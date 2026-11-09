import { describe, expect, it } from 'vitest';
import { findingId, percentChange, previousPeriod } from '../src/insights';

describe('previousPeriod', () => {
  it('is the same number of days immediately before', () => {
    expect(previousPeriod('2026-11-02', '2026-11-08')).toEqual({ from: '2026-10-26', to: '2026-11-01' });
  });
  it('handles a 31-day month across a short February', () => {
    expect(previousPeriod('2026-03-01', '2026-03-31')).toEqual({ from: '2026-01-29', to: '2026-02-28' });
  });
  it('a single day is the day before', () => {
    expect(previousPeriod('2026-01-01', '2026-01-01')).toEqual({ from: '2025-12-31', to: '2025-12-31' });
  });
});

describe('percentChange', () => {
  it('reports the rise or fall, to one decimal', () => {
    expect(percentChange(12, 10, 1)).toBe(20);
    expect(percentChange(9, 12, 1)).toBe(-25);
    expect(percentChange(10, 3, 1)).toBe(233.3);
  });
  it('says nothing without a meaningful baseline', () => {
    expect(percentChange(5, 0, 1)).toBeNull();
    expect(percentChange(5, null, 1)).toBeNull();
    expect(percentChange(5, 0.5, 1)).toBeNull();
  });
});

describe('findingId', () => {
  it('is stable and readable', () => {
    expect(findingId('workforce', 'overtime_trend', 'team-1')).toBe('workforce:overtime_trend:team-1');
  });
});
