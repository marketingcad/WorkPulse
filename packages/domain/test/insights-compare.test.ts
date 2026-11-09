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

describe('final review fixes (periods and caps)', () => {
  it('I4: the pay period before a given one', async () => {
    const { previousPayPeriod } = await import('../src/insights');
    expect(previousPayPeriod('2026-11-02', { type: 'weekly' }, 1)).toEqual({ start: '2026-10-26', end: '2026-11-01' });
  });
  it('I9: the most recent ended pay periods in a range, newest last', async () => {
    const { endedPayPeriods } = await import('../src/insights');
    const p = endedPayPeriods('2026-08-01', '2026-11-08', '2026-11-09', { type: 'weekly' }, 1, 5);
    expect(p).toHaveLength(5);
    expect(p[4]).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(p[0]!.start).toBe('2026-10-05');
    expect(endedPayPeriods('2026-11-09', '2026-11-15', '2026-11-09', { type: 'weekly' }, 1, 5)).toEqual([]);
  });
  it('I7: keeps the most important findings and says how many were left out', async () => {
    const { capFindings } = await import('../src/insights');
    const mk = (i: number, severity: 'info' | 'warning') => ({ id: `x${i}`, severity });
    const many = [...Array.from({ length: 70 }, (_, i) => mk(i, 'info')), mk(99, 'warning')];
    const r = capFindings(many, 50);
    expect(r.findings).toHaveLength(50);
    expect(r.findings[0]!.id).toBe('x99');
    expect(r.limitation).toBe('Showing the 50 most important of 71 findings.');
    expect(capFindings(many.slice(0, 3), 50).limitation).toBeNull();
  });
});
