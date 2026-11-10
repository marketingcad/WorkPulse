import { describe, expect, it } from 'vitest';
import { plainPortalSummary, portalSummaryFacts } from '../src/insights';

const insights = {
  totals: { completion_pct: 60, tasks_done: 12, tasks_open: 8, milestones_done: 1, milestones_total: 3, next_milestone: { title: 'Launch', due_date: '2026-11-30' } },
  projects: [
    { name: 'Website redesign', completion_pct: 60, tasks: { done: 12, open: 8 }, milestones: { done: 1, total: 3 }, delivery: 'BEHIND' as const, next_milestone: { title: 'Launch', due_date: '2026-11-30' } },
  ],
  milestones: [{ title: 'Beta', overdue: true }, { title: 'Launch', overdue: false }],
  contributors: [{ name: 'Walt Worker' }],
};

describe('portal summary facts', () => {
  it('states progress, milestones and the estimated finish, project by project', () => {
    const f = portalSummaryFacts(insights, [{ project: 'Website redesign', finishDate: '2026-12-14', late: false }]);
    expect(f.lines).toContain('Website redesign: 12 of 20 tasks done (60 %).');
    expect(f.lines).toContain('Website redesign: next milestone Launch, due 2026-11-30.');
    expect(f.lines).toContain('1 milestone is overdue.');
    expect(f.lines).toContain('At the recent pace, Website redesign is estimated to finish around 2026-12-14.');
  });

  it('never carries names of people, hours or money', () => {
    const f = portalSummaryFacts(insights, []);
    const text = f.lines.join(' ') + plainPortalSummary(f);
    expect(text).not.toMatch(/Walt|hour|\$|minor|invoice|rate/i);
  });

  it('works without task details (tasks not shared) and without projects', () => {
    const noTasks = portalSummaryFacts({ ...insights, projects: [{ ...insights.projects[0]!, tasks: null }] }, []);
    expect(noTasks.lines.some((l) => l.includes('tasks done'))).toBe(false);
    expect(plainPortalSummary(portalSummaryFacts({ ...insights, projects: [], milestones: [] }, []))).toBe('There is no project activity to report yet.');
  });

  it('writes a plain summary from the facts', () => {
    const s = plainPortalSummary(portalSummaryFacts(insights, []));
    expect(s).toContain('Website redesign: 12 of 20 tasks done (60 %).');
  });
});
