import { describe, expect, it } from 'vitest';
import { NAV_TARGET_KEYS } from '../src/assistant';
import { projectFindings, type ProjectFacts } from '../src/insights';

const period = { from: '2026-11-02', to: '2026-11-08' };
const project = (p: Partial<ProjectFacts>): ProjectFacts => ({
  id: 'p',
  name: 'Project',
  budget: null,
  tasks: { open: 0, overdue: 0, dueNext14: 0, done: 0 },
  milestones: { late: 0, overdue: 0, next: null },
  hoursThisPeriod: 10,
  hoursPreviousPeriod: 10,
  ...p,
});
const run = (projects: ProjectFacts[]) => projectFindings({ period, today: '2026-11-08', projects });

describe('projectFindings', () => {
  it('notes a project near its budget as a fact', () => {
    const f = run([project({ name: 'Web', budget: { kind: 'HOURS', pctUsed: 82, state: 'warning', projectedPct: 95 } })]);
    expect(f.findings.find((x) => x.category === 'budget_near')).toMatchObject({ basis: 'fact', severity: 'attention' });
  });

  it('labels a projection as an estimate, worded as one', () => {
    const f = run([project({ name: 'Web', budget: { kind: 'HOURS', pctUsed: 40, state: 'healthy', projectedPct: 130 } })]);
    const p = f.findings.find((x) => x.category === 'budget_projection')!;
    expect(p.basis).toBe('estimate');
    expect(p.summary.startsWith('At the current pace')).toBe(true);
    expect(p.metrics).toContainEqual({ label: 'Projected use', value: 130, unit: 'percent' });
  });

  it('an exceeded budget is reported once, without a projection', () => {
    const f = run([project({ budget: { kind: 'MONEY', pctUsed: 112, state: 'exceeded', projectedPct: 150 } })]);
    expect(f.findings.map((x) => x.category)).toEqual(['budget_exceeded']);
    expect(f.findings[0]!.severity).toBe('warning');
  });

  it('counts overdue tasks and milestones', () => {
    const f = run([project({ tasks: { open: 5, overdue: 2, dueNext14: 1, done: 3 }, milestones: { late: 0, overdue: 1, next: null } })]);
    const o = f.findings.find((x) => x.category === 'overdue_work')!;
    expect(o.metrics).toContainEqual({ label: 'Overdue tasks', value: 2, unit: 'count' });
    expect(o.metrics).toContainEqual({ label: 'Overdue milestones', value: 1, unit: 'count' });
  });

  it('estimates a deadline risk when work is due and effort fell', () => {
    const f = run([project({ tasks: { open: 6, overdue: 0, dueNext14: 3, done: 0 }, hoursThisPeriod: 4, hoursPreviousPeriod: 10 })]);
    expect(f.findings.find((x) => x.category === 'deadline_risk')).toMatchObject({ basis: 'estimate' });
    const steady = run([project({ tasks: { open: 6, overdue: 0, dueNext14: 3, done: 0 }, hoursThisPeriod: 9, hoursPreviousPeriod: 10 })]);
    expect(steady.findings.some((x) => x.category === 'deadline_risk')).toBe(false);
  });

  it('groups healthy projects into one finding', () => {
    const f = run([project({ id: 'a', name: 'Alpha' }), project({ id: 'b', name: 'Beta' })]);
    expect(f.findings).toHaveLength(1);
    expect(f.findings[0]).toMatchObject({ category: 'healthy', severity: 'info' });
    expect(f.findings[0]!.summary).toContain('Alpha');
  });

  it('says so when there are no projects', () => {
    expect(run([]).limitations).toContain('No projects to analyse.');
  });

  it('only links to known pages', () => {
    const f = run([project({ budget: { kind: 'HOURS', pctUsed: 120, state: 'exceeded', projectedPct: null }, tasks: { open: 1, overdue: 1, dueNext14: 3, done: 0 }, hoursThisPeriod: 1, hoursPreviousPeriod: 10 })]);
    for (const x of f.findings) for (const l of x.links) expect(NAV_TARGET_KEYS).toContain(l);
  });
});
