import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ACHIEVEMENTS,
  DEFAULT_PERFORMANCE_WEIGHTS,
  DomainError,
  ORG_ONLY_PERMISSIONS,
  ROLE_PRESETS,
  assertValidWeights,
  awardPeriodKey,
  computeScore,
  evaluateGoal,
  SCORE_SETTLE_DAYS,
  goalMetricAllowed,
  isPeriodSettled,
  metricValues,
  periodBounds,
  rankEntries,
  ratingScore,
  ratioScore,
  thresholdIssues,
  tiersReached,
  weightIssues,
  type MetricValues,
} from '../src';

const none: MetricValues = { goals: null, delivery: null, consistency: null, quality: null, attendance: null };

describe('performance weights', () => {
  it('the defaults are valid and add up to 100', () => {
    expect(weightIssues(DEFAULT_PERFORMANCE_WEIGHTS)).toEqual([]);
  });
  it('rejects weights that do not add up to 100, fractions, negatives and unknown metrics', () => {
    expect(weightIssues({ ...DEFAULT_PERFORMANCE_WEIGHTS, goals: 31 })[0]).toMatch(/add up to 100% \(they add up to 101%\)/);
    expect(weightIssues({ ...DEFAULT_PERFORMANCE_WEIGHTS, goals: 29.5, delivery: 25.5 })[0]).toMatch(/whole number/);
    expect(weightIssues({ ...DEFAULT_PERFORMANCE_WEIGHTS, goals: -10, delivery: 65 })[0]).toMatch(/goals weight/);
    expect(weightIssues({ ...DEFAULT_PERFORMANCE_WEIGHTS, activity: 0 })).toContain('Unknown metric "activity"');
    const { quality: _q, ...missing } = DEFAULT_PERFORMANCE_WEIGHTS;
    expect(weightIssues(missing)[0]).toMatch(/quality weight/);
    expect(() => assertValidWeights({ ...DEFAULT_PERFORMANCE_WEIGHTS, goals: 0 })).toThrow(DomainError);
  });
});

describe('normalizing metrics to 0–100', () => {
  it('a ratio is a percentage with one decimal, clamped to the whole', () => {
    expect(ratioScore(2, 3)).toBe(66.7);
    expect(ratioScore(5, 4)).toBe(100);
    expect(ratioScore(-1, 4)).toBe(0);
  });
  it('nothing to measure is null, never zero', () => {
    expect(ratioScore(0, 0)).toBeNull();
    expect(ratioScore(3, Number.NaN)).toBeNull();
    expect(ratingScore([])).toBeNull();
  });
  it('review ratings map 1 → 0, 3 → 50, 5 → 100 (out-of-range ratings are clamped)', () => {
    expect(ratingScore([1])).toBe(0);
    expect(ratingScore([3])).toBe(50);
    expect(ratingScore([5, 4])).toBe(87.5);
    expect(ratingScore([9])).toBe(100);
  });
  it('metricValues maps every input and keeps unmeasured ones null', () => {
    expect(metricValues({ goals: { completed: 3, due: 4 }, delivery: { onTime: 0, due: 0 }, consistency: { approvedDays: 9, scheduledDays: 10 }, quality: { ratings: [] }, attendance: { onTime: 0, scheduled: 5 } })).toEqual({
      goals: 75,
      delivery: null,
      consistency: 90,
      quality: null,
      attendance: 0,
    });
  });
});

describe('computeScore', () => {
  const w = DEFAULT_PERFORMANCE_WEIGHTS;
  it('weights every measured metric', () => {
    const r = computeScore({ goals: 82, delivery: 74, consistency: 88, quality: 69, attendance: 93 }, w);
    expect(r.score).toBe(80.4);
    expect(r.coverage).toBe(100);
    expect(r.parts.goals).toEqual({ value: 82, weight: 30, effective_weight: 30 });
  });
  it('leaves a missing metric out and re-weights the rest, instead of counting it as zero', () => {
    const r = computeScore({ goals: 80, delivery: null, consistency: 80, quality: 80, attendance: 80 }, w);
    expect(r.score).toBe(80);
    expect(r.coverage).toBe(75);
    expect(r.parts.delivery).toEqual({ value: null, weight: 25, effective_weight: 0 });
    expect(r.parts.goals.effective_weight).toBe(40);
  });
  it('gives no score when less than half the weight was measured', () => {
    expect(computeScore({ ...none, quality: 100, attendance: 100 }, w).score).toBeNull();
    expect(computeScore(none, w)).toMatchObject({ score: null, coverage: 0 });
    // exactly the minimum is enough
    expect(computeScore({ ...none, goals: 60, consistency: 90 }, w).score).toBe(72);
  });
  it('cannot be pushed out of range by a bad value', () => {
    expect(computeScore({ goals: 500, delivery: -40, consistency: 100, quality: 100, attendance: 100 }, w).score).toBe(75);
  });
  it('a zero weight means the metric does not count, even when measured', () => {
    const r = computeScore({ goals: 0, delivery: 100, consistency: 100, quality: 100, attendance: 100 }, { goals: 0, delivery: 40, consistency: 30, quality: 20, attendance: 10 });
    expect(r.score).toBe(100);
  });
  it('the same inputs and rules always give the same score (reproducible history)', () => {
    const values = { goals: 70, delivery: 61.5, consistency: 88, quality: null, attendance: 95 };
    const old = { goals: 40, delivery: 20, consistency: 20, quality: 10, attendance: 10 };
    const a = computeScore(values, old).score;
    computeScore(values, w);
    expect(computeScore(values, old).score).toBe(a);
    expect(a).not.toBe(computeScore(values, w).score);
  });
  it('rejects invalid weights', () => {
    expect(() => computeScore(none, { ...w, goals: 50 })).toThrow(/add up to 100/);
  });
});

describe('periods', () => {
  it('weeks follow the organization week start; months, quarters and years are calendar periods', () => {
    expect(periodBounds('WEEK', '2026-11-05', 1)).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(periodBounds('WEEK', '2026-11-05', 0)).toEqual({ start: '2026-11-01', end: '2026-11-07' });
    expect(periodBounds('MONTH', '2026-02-14')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodBounds('MONTH', '2028-02-14')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(periodBounds('QUARTER', '2026-11-05')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(periodBounds('YEAR', '2026-11-05')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });
  it('award period keys: one per period, and a single one for once-only achievements', () => {
    expect(awardPeriodKey('MONTH', '2026-11-30')).toBe('2026-11');
    expect(awardPeriodKey('MONTH', '2026-11-01')).toBe(awardPeriodKey('MONTH', '2026-11-30'));
    expect(awardPeriodKey('QUARTER', '2026-11-05')).toBe('2026-Q4');
    expect(awardPeriodKey('YEAR', '2026-11-05')).toBe('2026');
    expect(awardPeriodKey('WEEK', '2026-11-05', 1)).toBe('week:2026-11-02');
    expect(awardPeriodKey('ONCE', '2026-11-05')).toBe(awardPeriodKey('ONCE', '2031-01-01'));
  });
});

describe('achievement eligibility', () => {
  it('reaches every level up to the value, lowest first', () => {
    expect(tiersReached([4, 8, 13, 26], 3)).toEqual([]);
    expect(tiersReached([4, 8, 13, 26], 13)).toEqual(['BRONZE', 'SILVER', 'GOLD']);
    expect(tiersReached([4, 8, 13, 26], 400)).toEqual(['BRONZE', 'SILVER', 'GOLD', 'PLATINUM']);
    expect(tiersReached([1], 1)).toEqual(['BRONZE']);
  });
  it('rejects levels that are not increasing, empty or too many', () => {
    expect(thresholdIssues([10, 10])).toHaveLength(1);
    expect(thresholdIssues([])).toHaveLength(1);
    expect(thresholdIssues([1, 2, 3, 4, 5])).toHaveLength(1);
    expect(thresholdIssues([0, 3])).toHaveLength(1);
    expect(tiersReached([10, 5], 20)).toEqual([]);
  });
  it('the built-in catalogue is consistent: automatic ones have a measure and valid levels, keys are unique', () => {
    const keys = new Set(BUILTIN_ACHIEVEMENTS.map((a) => a.key));
    expect(keys.size).toBe(BUILTIN_ACHIEVEMENTS.length);
    for (const a of BUILTIN_ACHIEVEMENTS) {
      if (a.mode === 'AUTOMATIC') {
        expect(a.metric, a.key).toBeDefined();
        expect(thresholdIssues(a.thresholds ?? []), a.key).toEqual([]);
      } else expect(a.metric, a.key).toBeUndefined();
    }
  });
});

describe('goals', () => {
  const base = { metric: 'TASKS_COMPLETED' as const, target: 20, startDate: '2026-11-01', endDate: '2026-11-30' };
  it('a count goal completes as soon as it reaches its target', () => {
    expect(evaluateGoal({ ...base, current: 20 }, '2026-11-10')).toEqual({ status: 'COMPLETED', progress_pct: 100, pace: null });
  });
  it('is missed when the end date passes first', () => {
    expect(evaluateGoal({ ...base, current: 14 }, '2026-12-01')).toEqual({ status: 'MISSED', progress_pct: 70, pace: null });
  });
  it('pace compares progress with the time elapsed', () => {
    expect(evaluateGoal({ ...base, current: 14 }, '2026-11-15').pace).toBe('AHEAD');
    expect(evaluateGoal({ ...base, current: 10 }, '2026-11-15').pace).toBe('ON_TRACK');
    expect(evaluateGoal({ ...base, current: 2 }, '2026-11-20').pace).toBe('AT_RISK');
    expect(evaluateGoal({ ...base, current: 0 }, '2026-10-20').pace).toBeNull();
  });
  it('a percentage goal is only settled at its end date', () => {
    const g = { ...base, metric: 'ON_TIME_PCT' as const, target: 95 };
    expect(evaluateGoal({ ...g, current: 97 }, '2026-11-10')).toEqual({ status: 'ACTIVE', progress_pct: 100, pace: 'ON_TRACK' });
    expect(evaluateGoal({ ...g, current: 97 }, '2026-12-01').status).toBe('COMPLETED');
    expect(evaluateGoal({ ...g, current: 90 }, '2026-12-01').status).toBe('MISSED');
  });
  it('needs a target above zero', () => {
    expect(() => evaluateGoal({ ...base, target: 0, current: 0 }, '2026-11-10')).toThrow(DomainError);
  });
  it('a metric only applies to subjects it can be measured for', () => {
    expect(goalMetricAllowed('MILESTONES_COMPLETED', 'MEMBER')).toBe(false);
    expect(goalMetricAllowed('MILESTONES_COMPLETED', 'PROJECT')).toBe(true);
    expect(goalMetricAllowed('ON_TIME_PCT', 'PROJECT')).toBe(false);
    expect(goalMetricAllowed('TASKS_COMPLETED', 'MEMBER')).toBe(true);
  });
});

describe('rankings', () => {
  it('ties share a rank and the next rank skips (1, 2, 2, 4)', () => {
    const r = rankEntries([
      { id: 'a', score: 90, eligible: true, name: 'Ann' },
      { id: 'b', score: 80, eligible: true, name: 'Bea' },
      { id: 'c', score: 80, eligible: true, name: 'Cal' },
      { id: 'd', score: 70, eligible: true, name: 'Dee' },
    ]);
    expect(r.map((e) => [e.id, e.rank])).toEqual([['a', 1], ['b', 2], ['c', 2], ['d', 4]]);
  });
  it('people not eligible or without a score are listed after, without a rank', () => {
    const r = rankEntries([
      { id: 'new', score: 99, eligible: false, name: 'New starter' },
      { id: 'none', score: null, eligible: true, name: 'No data' },
      { id: 'x', score: 60, eligible: true, name: 'X' },
    ]);
    expect(r.map((e) => [e.id, e.rank])).toEqual([['x', 1], ['new', null], ['none', null]]);
  });
  it('ranks within each group only, so different roles are not compared', () => {
    const r = rankEntries([
      { id: 'dev', score: 70, eligible: true, group: 'engineer' },
      { id: 'des', score: 60, eligible: true, group: 'designer' },
    ]);
    expect(r.find((e) => e.id === 'dev')!.rank).toBe(1);
    expect(r.find((e) => e.id === 'des')!.rank).toBe(1);
  });
});

describe('performance permissions', () => {
  it('workers get only their own progress, managers their teams, admins everything', () => {
    expect(ROLE_PRESETS.WORKER['performance:read']).toBe('own');
    expect(ROLE_PRESETS.WORKER['reviews:read']).toBeUndefined();
    expect(ROLE_PRESETS.WORKER['goals:manage']).toBeUndefined();
    expect(ROLE_PRESETS.WORKER['achievements:award']).toBeUndefined();
    expect(ROLE_PRESETS.TEAM_MANAGER['reviews:manage']).toBe('team');
    expect(ROLE_PRESETS.TEAM_MANAGER['performance:manage']).toBeUndefined();
    expect(ROLE_PRESETS.SYSTEM_ADMIN['performance:manage']).toBe('org');
    expect(ROLE_PRESETS.AGENT['performance:read']).toBeUndefined();
  });
  it('scoring rules and the achievement catalogue are organization-wide only', () => {
    expect(ORG_ONLY_PERMISSIONS).toContain('performance:manage');
    expect(ORG_ONLY_PERMISSIONS).toContain('achievements:manage');
  });
});

describe('when the scores of a period become final', () => {
  it('stays open for SCORE_SETTLE_DAYS after the period ends, so late approvals and reviews count', () => {
    expect(SCORE_SETTLE_DAYS).toBe(14);
    expect(isPeriodSettled('2026-11-30', '2026-11-30')).toBe(false);
    expect(isPeriodSettled('2026-11-30', '2026-12-01')).toBe(false);
    expect(isPeriodSettled('2026-11-30', '2026-12-14')).toBe(false);
    expect(isPeriodSettled('2026-11-30', '2026-12-15')).toBe(true);
    // Across a year end.
    expect(isPeriodSettled('2026-12-31', '2027-01-14')).toBe(false);
    expect(isPeriodSettled('2026-12-31', '2027-01-15')).toBe(true);
  });
});
