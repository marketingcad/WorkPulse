import { describe, expect, it } from 'vitest';
import { NAV_TARGET_KEYS } from '../src/assistant';
import { workforceFindings, type GroupHours } from '../src/insights';

const H = 3600;
const period = { from: '2026-11-02', to: '2026-11-08' };
const previous = { from: '2026-10-26', to: '2026-11-01' };
const team = (g: Partial<GroupHours>): GroupHours => ({ id: 't', name: 'Team', type: 'team', seconds: 0, previousSeconds: null, overtimeSeconds: 0, previousOvertimeSeconds: null, approvedSeconds: 0, ...g });
const totals = (t: Partial<Parameters<typeof workforceFindings>[0]['totals']> = {}) => ({ seconds: 100 * H, previousSeconds: 80 * H, approvedSeconds: 60 * H, overtimeSeconds: 0, previousOvertimeSeconds: 0, ...t });
const run = (over: Partial<Parameters<typeof workforceFindings>[0]> = {}) =>
  workforceFindings({ period, previous, totals: totals(), groups: [], pending: 0, missing: 0, timeOff: { peopleAway: 0, pendingRequests: 0 }, ...over });

describe('workforceFindings', () => {
  it('reports the organization trend against the previous period', () => {
    const { findings } = run();
    const t = findings.find((f) => f.category === 'hours_trend')!;
    expect(t.basis).toBe('observation');
    expect(t.metrics).toContainEqual({ label: 'Hours', value: 100, unit: 'hours', previous: 80 });
    expect(t.metrics).toContainEqual({ label: 'Change', value: 25, unit: 'percent' });
  });

  it('flags a team whose workload rose, only with a real baseline', () => {
    const { findings } = run({ groups: [team({ id: 'a', name: 'Team A', seconds: 30 * H, previousSeconds: 20 * H }), team({ id: 'b', name: 'Team B', seconds: 5 * H, previousSeconds: 4 * H })] });
    const up = findings.filter((f) => f.category === 'workload_up');
    expect(up).toHaveLength(1);
    expect(up[0]!.refs[0]).toMatchObject({ type: 'team', name: 'Team A' });
    expect(up[0]!.metrics).toContainEqual({ label: 'Change', value: 50, unit: 'percent' });
  });

  it('flags overtime that appeared or rose', () => {
    const { findings } = run({ groups: [team({ id: 'a', name: 'Team A', seconds: 44 * H, previousSeconds: 40 * H, overtimeSeconds: 4 * H, previousOvertimeSeconds: 0 })] });
    const ot = findings.find((f) => f.category === 'overtime_trend')!;
    expect(ot.severity).toBe('attention');
    expect(ot.metrics).toContainEqual({ label: 'Overtime', value: 4, unit: 'hours', previous: 0 });
  });

  it('says there is nothing to compare with instead of inventing a trend', () => {
    const { findings, limitations } = run({ totals: totals({ previousSeconds: null }), groups: [team({ seconds: 30 * H, previousSeconds: null })] });
    expect(limitations).toContain('No previous period to compare with.');
    expect(findings.find((f) => f.category === 'hours_trend')!.metrics.find((m) => m.label === 'Change')).toBeUndefined();
    expect(findings.some((f) => f.category === 'workload_up')).toBe(false);
  });

  it('lists approvals waiting and missing timesheets as facts', () => {
    const { findings } = run({ pending: 3, missing: 2 });
    expect(findings.find((f) => f.category === 'approval_backlog')).toMatchObject({ basis: 'fact', links: ['timesheets.approvals'] });
    expect(findings.find((f) => f.category === 'missing_timesheets')!.metrics[0]!.value).toBe(2);
  });

  it('reports the approved share of tracked time', () => {
    const { findings } = run();
    expect(findings.find((f) => f.category === 'approved_share')!.metrics).toContainEqual({ label: 'Approved', value: 60, unit: 'percent' });
  });

  it('only links to known pages', () => {
    const { findings } = run({ pending: 1, missing: 1, groups: [team({ seconds: 30 * H, previousSeconds: 10 * H, overtimeSeconds: 5 * H, previousOvertimeSeconds: 1 * H })], timeOff: { peopleAway: 2, pendingRequests: 1 } });
    for (const f of findings) for (const l of f.links) expect(NAV_TARGET_KEYS).toContain(l);
  });
});

describe('workforceFindings without approval data', () => {
  it('leaves out the approved share when the person cannot see approvals', () => {
    const { findings } = workforceFindings({ period, previous, totals: totals({ approvedSeconds: null }), groups: [], pending: 0, missing: 0, timeOff: { peopleAway: 0, pendingRequests: 0 } });
    expect(findings.some((f) => f.category === 'approved_share')).toBe(false);
  });
});

describe('final review fixes (time off)', () => {
  it('I6: counts people away, not calendar days (weekends and holidays are not days away)', () => {
    const { findings } = workforceFindings({ period, previous, totals: totals(), groups: [], pending: 0, missing: 0, timeOff: { peopleAway: 3, pendingRequests: 1 } });
    const f = findings.find((x) => x.category === 'time_off')!;
    expect(f.metrics).toContainEqual({ label: 'People away', value: 3, unit: 'count' });
    expect(f.summary).toContain('3 people');
  });
});
