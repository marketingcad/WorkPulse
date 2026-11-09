import { describe, expect, it } from 'vitest';
import { NAV_TARGET_KEYS } from '../src/assistant';
import { workflowFindings } from '../src/insights';

const period = { from: '2026-11-02', to: '2026-11-08' };
const item = (id: string, submittedOn: string, concerns = 0, kind: 'timesheet' | 'manual_time' | 'time_off' | 'expense' = 'timesheet') => ({ kind, id, memberName: `M ${id}`, submittedOn, concerns });
const run = (over: Partial<Parameters<typeof workflowFindings>[0]> = {}) => workflowFindings({ period, today: '2026-11-10', waiting: [], decisionDays: { current: null, previous: null }, ...over });

describe('workflowFindings', () => {
  it('orders what to review first by concerns, then the oldest', () => {
    const { findings } = run({ waiting: [item('a', '2026-11-09'), item('b', '2026-11-08', 2), item('c', '2026-11-05')] });
    const f = findings.find((x) => x.category === 'review_first')!;
    expect(f.refs.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(f.basis).toBe('fact');
  });
  it('notes items waiting more than three days', () => {
    const { findings } = run({ waiting: [item('a', '2026-11-05'), item('b', '2026-11-09')] });
    const f = findings.find((x) => x.category === 'waiting_long')!;
    expect(f.metrics[0]).toMatchObject({ value: 1, unit: 'count' });
    expect(f.summary).toContain('M a');
  });
  it('compares decision time with the previous period, or says it cannot', () => {
    const a = run({ decisionDays: { current: 2, previous: 1 } });
    expect(a.findings.find((x) => x.category === 'decision_time')!.metrics).toContainEqual({ label: 'Change', value: 100, unit: 'percent' });
    const b = run({ decisionDays: { current: 2, previous: null } });
    expect(b.limitations).toContain('No decisions in the previous period to compare with.');
    expect(b.findings.find((x) => x.category === 'decision_time')!.metrics.some((m) => m.label === 'Change')).toBe(false);
  });
  it('counts what is waiting by kind, and links only to known pages', () => {
    const { findings } = run({ waiting: [item('a', '2026-11-09'), item('b', '2026-11-09', 0, 'time_off'), item('c', '2026-11-09', 0, 'expense')], decisionDays: { current: 1, previous: 1 } });
    expect(findings.find((x) => x.category === 'backlog_mix')!.metrics.map((m) => m.label)).toEqual(['Timesheets', 'Manual time', 'Time off', 'Expenses']);
    for (const f of findings) for (const l of f.links) expect(NAV_TARGET_KEYS).toContain(l);
  });
  it('says so when nothing is waiting and nothing was decided', () => {
    const r = run();
    expect(r.findings).toEqual([]);
    expect(r.limitations).toContain('Nothing is waiting for a decision.');
  });
});
