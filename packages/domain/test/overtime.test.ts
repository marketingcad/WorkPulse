import { describe, expect, it } from 'vitest';
import { overtimeByDay, splitOvertime } from '../src/index';

const h = (n: number) => n * 3600;
const WEEKLY_40 = { dailyThresholdSeconds: null, weeklyThresholdSeconds: h(40) };

describe('overtime day by day', () => {
  it('weekly overtime falls on the days worked past the 40th hour', () => {
    expect(overtimeByDay([10, 10, 10, 10, 10, 0, 0].map(h), WEEKLY_40)).toEqual([
      { regular: h(10), overtime: 0 },
      { regular: h(10), overtime: 0 },
      { regular: h(10), overtime: 0 },
      { regular: h(10), overtime: 0 },
      { regular: 0, overtime: h(10) },
      { regular: 0, overtime: 0 },
      { regular: 0, overtime: 0 },
    ]);
  });

  it('a day can be partly regular and partly overtime', () => {
    expect(overtimeByDay([9, 9, 9, 9, 9].map(h), WEEKLY_40).at(-1)).toEqual({ regular: h(4), overtime: h(5) });
  });

  it('daily overtime stays on its own day, and weekly overtime counts only the remaining regular hours', () => {
    const rules = { dailyThresholdSeconds: h(8), weeklyThresholdSeconds: h(40) };
    // 10 h a day: 2 h daily overtime each day, 8 h regular each day reaches 40 h on Friday.
    expect(overtimeByDay([10, 10, 10, 10, 10, 8].map(h), rules)).toEqual([
      { regular: h(8), overtime: h(2) },
      { regular: h(8), overtime: h(2) },
      { regular: h(8), overtime: h(2) },
      { regular: h(8), overtime: h(2) },
      { regular: h(8), overtime: h(2) },
      { regular: 0, overtime: h(8) },
    ]);
  });

  it('adds up to the weekly split, for any week', () => {
    const rulesets = [WEEKLY_40, { dailyThresholdSeconds: h(8), weeklyThresholdSeconds: h(40) }, { dailyThresholdSeconds: h(9), weeklyThresholdSeconds: h(45) }, { dailyThresholdSeconds: null, weeklyThresholdSeconds: null }];
    const weeks = [[9, 9, 9, 9, 9, 3, 0], [12, 0, 12, 0, 12, 12, 2], [0, 0, 0, 0, 0, 0, 0], [7.5, 7.5, 7.5, 7.5, 7.5, 7.5, 7.5]];
    for (const rules of rulesets) {
      for (const w of weeks) {
        const days = overtimeByDay(w.map(h), rules);
        const sum = days.reduce((s, d) => ({ regular: s.regular + d.regular, overtime: s.overtime + d.overtime }), { regular: 0, overtime: 0 });
        expect(sum).toEqual(splitOvertime(w.map(h), rules));
        days.forEach((d, i) => expect(d.regular + d.overtime).toBe(h(w[i]!)));
      }
    }
  });
});
