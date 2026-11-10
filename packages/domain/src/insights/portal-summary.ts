/**
 * The facts a client's portal summary is written from: delivery facts of the client's own projects
 * only (completion, tasks, milestones, estimated finish). Never people's names, hours or money, so
 * nothing else can reach the AI or the plain summary.
 */
export interface PortalSummaryInput {
  projects: Array<{
    name: string;
    completion_pct: number | null;
    /** null when tasks are not shared on this dashboard */
    tasks: { done: number; open: number } | null;
    milestones: { done: number; total: number };
    delivery: 'DONE' | 'BEHIND' | 'ON_TRACK' | null;
    next_milestone: { title: string; due_date: string } | null;
  }>;
  milestones: Array<{ overdue: boolean }>;
}

export interface PortalSummaryFacts {
  lines: string[];
}

const MAX_PROJECTS = 10;

export function portalSummaryFacts(insights: PortalSummaryInput, forecasts: Array<{ project: string; finishDate: string | null; late: boolean }>): PortalSummaryFacts {
  const lines: string[] = [];
  for (const p of insights.projects.slice(0, MAX_PROJECTS)) {
    if (p.tasks && p.tasks.done + p.tasks.open > 0) lines.push(`${p.name}: ${p.tasks.done} of ${p.tasks.done + p.tasks.open} tasks done${p.completion_pct === null ? '' : ` (${p.completion_pct} %)`}.`);
    else if (p.milestones.total > 0) lines.push(`${p.name}: ${p.milestones.done} of ${p.milestones.total} milestones delivered.`);
    if (p.delivery === 'DONE') lines.push(`${p.name}: every milestone is delivered.`);
    else if (p.delivery === 'BEHIND') lines.push(`${p.name}: a milestone is past its due date.`);
    if (p.next_milestone) lines.push(`${p.name}: next milestone ${p.next_milestone.title}, due ${p.next_milestone.due_date}.`);
    const f = forecasts.find((x) => x.project === p.name);
    if (f?.finishDate) lines.push(`At the recent pace, ${p.name} is estimated to finish around ${f.finishDate}${f.late ? ', after its planned end date' : ''}.`);
  }
  const overdue = insights.milestones.filter((m) => m.overdue).length;
  if (overdue) lines.push(`${overdue} ${overdue === 1 ? 'milestone is' : 'milestones are'} overdue.`);
  return { lines };
}

/** The summary without AI: the facts, as written. */
export function plainPortalSummary(facts: PortalSummaryFacts): string {
  return facts.lines.length ? facts.lines.join(' ') : 'There is no project activity to report yet.';
}
