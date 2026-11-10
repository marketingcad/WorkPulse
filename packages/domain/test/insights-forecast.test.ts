import { describe, expect, it } from 'vitest';
import { financeFindings, finishForecast, monthEndProjection, projectFindings, workforceFindings, type ProjectFacts } from '../src/insights';

const H = 3600;

describe('finishForecast', () => {
  it('estimates the finish date from the last four weeks of progress', () => {
    // 8 tasks done in 4 weeks = 2 a week; 10 open = 5 weeks = 35 days.
    expect(finishForecast({ open: 10, doneLast28: 8, today: '2026-11-10', endDate: '2026-11-20' })).toEqual({ weeks: 5, finishDate: '2026-12-15', late: true });
    expect(finishForecast({ open: 10, doneLast28: 8, today: '2026-11-10', endDate: '2027-01-31' })).toMatchObject({ late: false });
    expect(finishForecast({ open: 10, doneLast28: 8, today: '2026-11-10', endDate: null })).toMatchObject({ late: false });
  });

  it('invents nothing without recent progress or open work', () => {
    expect(finishForecast({ open: 10, doneLast28: 0, today: '2026-11-10', endDate: null })).toBeNull();
    expect(finishForecast({ open: 0, doneLast28: 8, today: '2026-11-10', endDate: null })).toBeNull();
  });
});

describe('monthEndProjection', () => {
  it('projects from the weekdays elapsed (before today) to all weekdays of the month', () => {
    // November 2026: 21 weekdays; 2–6 and 9 November have passed by the 10th.
    expect(monthEndProjection({ today: '2026-11-10', soFar: 60 })).toEqual({ monthStart: '2026-11-01', monthEnd: '2026-11-30', elapsedWeekdays: 6, totalWeekdays: 21, projected: 210 });
  });

  it('is too early to say in the first working days', () => {
    expect(monthEndProjection({ today: '2026-11-03', soFar: 8 })).toBeNull();
  });
});

const project = (p: Partial<ProjectFacts>): ProjectFacts => ({
  id: 'p',
  name: 'Web',
  budget: null,
  tasks: { open: 10, overdue: 0, dueNext14: 0, done: 8 },
  milestones: { late: 0, overdue: 0, next: null },
  hoursThisPeriod: 10,
  hoursPreviousPeriod: 10,
  ...p,
});

describe('project finish forecast', () => {
  const run = (p: Partial<ProjectFacts>) => projectFindings({ period: { from: '2026-11-02', to: '2026-11-08' }, today: '2026-11-10', projects: [project(p)] });

  it('flags a project likely to finish after its end date, as an estimate', () => {
    const f = run({ tasksDoneLast28: 8, endDate: '2026-11-20' }).findings.find((x) => x.category === 'finish_forecast')!;
    expect(f).toMatchObject({ basis: 'estimate', severity: 'attention' });
    expect(f.summary).toContain('2026-12-15');
    expect(f.summary).toContain('estimate');
    expect(f.metrics).toContainEqual({ label: 'Open tasks', value: 10, unit: 'count' });
    expect(f.metrics).toContainEqual({ label: 'Days to finish', value: 35, unit: 'days' });
  });

  it('is informational when on time', () => {
    expect(run({ tasksDoneLast28: 8, endDate: '2027-02-01' }).findings.find((x) => x.category === 'finish_forecast')!.severity).toBe('info');
  });

  it('says it cannot estimate without recent progress', () => {
    const r = run({ tasksDoneLast28: 0, endDate: null });
    expect(r.findings.some((x) => x.category === 'finish_forecast')).toBe(false);
    expect(r.limitations).toContain('Not enough recent progress to estimate when Web will finish.');
  });
});

describe('month-end forecasts', () => {
  const totals = { seconds: 40 * H, previousSeconds: 40 * H, approvedSeconds: null, overtimeSeconds: 0, previousOvertimeSeconds: 0 };
  const period = { from: '2026-11-02', to: '2026-11-08' };
  const previous = { from: '2026-10-26', to: '2026-11-01' };

  it('projects month-end hours as an estimate', () => {
    const { findings } = workforceFindings({ period, previous, totals, groups: [], pending: 0, missing: 0, timeOff: { peopleAway: 0, pendingRequests: 0 }, monthToDate: { today: '2026-11-10', seconds: 60 * H } });
    const f = findings.find((x) => x.category === 'month_end_hours')!;
    expect(f.basis).toBe('estimate');
    expect(f.metrics).toContainEqual({ label: 'So far', value: 60, unit: 'hours' });
    expect(f.metrics).toContainEqual({ label: 'Projected', value: 210, unit: 'hours' });
  });

  it('says when it is too early in the month', () => {
    const r = workforceFindings({ period, previous, totals, groups: [], pending: 0, missing: 0, timeOff: { peopleAway: 0, pendingRequests: 0 }, monthToDate: { today: '2026-11-03', seconds: 8 * H } });
    expect(r.findings.some((x) => x.category === 'month_end_hours')).toBe(false);
    expect(r.limitations).toContain('Too early in the month to project month-end hours.');
  });

  it('projects month-end pay per currency, in integer minor units', () => {
    const { findings } = financeFindings({ period, previous, today: '2026-11-10', payroll: null, owedEstimate: null, billing: null, monthToDatePay: [{ currency: 'USD', minor: 600_00 }, { currency: 'EUR', minor: 100_01 }] });
    const pay = findings.filter((x) => x.category === 'month_end_pay');
    expect(pay.map((f) => f.metrics[0]!.currency).sort()).toEqual(['EUR', 'USD']);
    const usd = pay.find((f) => f.metrics[0]!.currency === 'USD')!;
    expect(usd.basis).toBe('estimate');
    expect(usd.metrics).toContainEqual({ label: 'Projected', value: 2100_00, unit: 'money', currency: 'USD' });
    for (const f of pay) for (const m of f.metrics) expect(Number.isInteger(m.value)).toBe(true);
  });
});
