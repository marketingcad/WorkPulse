import { describe, expect, it } from 'vitest';
import { labelEvery, niceTicks, periodChange, rowTotal, topWithOther } from '../src/chart-math';

/** Chart arithmetic: honest axes, missing data kept apart from zero, and fair period comparisons. */
describe('niceTicks', () => {
  it('starts at zero and covers the maximum with round steps', () => {
    expect(niceTicks(9)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0)).toEqual([0]);
    // In whole hours (seconds on the axis): 0, 2h, 4h, 6h, 8h.
    expect(niceTicks(7.2 * 3600, 4, 3600)).toEqual([0, 7200, 14400, 21600, 28800]);
    for (const max of [1, 3, 7, 42, 999, 12345]) {
      const t = niceTicks(max);
      expect(t[0]).toBe(0);
      expect(t[t.length - 1]!).toBeGreaterThanOrEqual(max);
    }
  });
});

describe('rowTotal', () => {
  it('is null when every value is missing (no data), and zero only for real zeros', () => {
    expect(rowTotal({ a: 1, b: 2 }, ['a', 'b'])).toBe(3);
    expect(rowTotal({ a: 0, b: 0 }, ['a', 'b'])).toBe(0);
    expect(rowTotal({ a: null, b: undefined }, ['a', 'b'])).toBeNull();
    expect(rowTotal({ a: null, b: 4 }, ['a', 'b'])).toBe(4);
    // Only the series shown count.
    expect(rowTotal({ a: 1, b: 2 }, ['b'])).toBe(2);
  });
});

describe('periodChange', () => {
  it('compares a finished period with the whole previous one', () => {
    expect(periodChange(120, [10, 20, 30, 40], null)).toEqual({ previous: 100, change: 0.2, toDate: false });
  });
  it('compares a period in progress with the same days of the previous one, not all of it', () => {
    // Two days into the week: the first two days of last week.
    expect(periodChange(30, [10, 20, 30, 40, 50, 0, 0], 2)).toEqual({ previous: 30, change: 0, toDate: true });
  });
  it('has no change to show when there was nothing before', () => {
    expect(periodChange(50, [0, 0, 0], null)).toEqual({ previous: 0, change: null, toDate: false });
    expect(periodChange(50, [], null)).toBeNull();
  });
});

describe('topWithOther', () => {
  const other = (value: number, count: number) => ({ label: `Other (${count})`, value });
  it('keeps the largest and sums the rest, so a donut stays readable', () => {
    const items = [5, 9, 1, 7, 3, 2, 8].map((value, i) => ({ label: `p${i}`, value }));
    const r = topWithOther(items, 3, other);
    expect(r.map((x) => x.value)).toEqual([9, 8, 7, 11]);
    expect(r[3]!.label).toBe('Other (4)');
    // The total is unchanged.
    expect(r.reduce((s, x) => s + x.value, 0)).toBe(items.reduce((s, x) => s + x.value, 0));
  });
  it('does not group a single leftover, and drops empty items', () => {
    expect(topWithOther([{ label: 'a', value: 3 }, { label: 'b', value: 2 }, { label: 'c', value: 0 }], 1, other).map((x) => x.label)).toEqual(['a', 'b']);
  });
});

describe('labelEvery', () => {
  it('thins labels so they never overlap', () => {
    expect(labelEvery(7, 12)).toBe(1);
    expect(labelEvery(31, 12)).toBe(3);
    expect(labelEvery(31, 6)).toBe(6);
  });
});
