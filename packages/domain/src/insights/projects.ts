import { findingId, percentChange } from './compare';
import { finishForecast } from './forecast';
import type { Finding, Period } from './types';

export interface ProjectFacts {
  id: string;
  name: string;
  /** From the budget service: its own percent, state and linear projection. */
  budget: null | { kind: 'HOURS' | 'MONEY'; pctUsed: number; state: 'healthy' | 'warning' | 'exceeded'; projectedPct: number | null };
  tasks: { open: number; overdue: number; dueNext14: number; done: number };
  milestones: { late: number; overdue: number; next: { name: string; due: string } | null };
  /** Hours (not seconds) recorded on the project in this and the previous period. */
  hoursThisPeriod: number;
  hoursPreviousPeriod: number | null;
  /** Tasks completed in the last 28 days, for the finish forecast (absent: no forecast). */
  tasksDoneLast28?: number;
  /** The project's planned end date, if any. */
  endDate?: string | null;
}

const MAX_HEALTHY_NAMES = 10;

export function projectFindings(input: { period: Period; today: string; projects: ProjectFacts[] }): { findings: Finding[]; limitations: string[] } {
  const { period } = input;
  const findings: Finding[] = [];
  const limitations: string[] = [];
  if (!input.projects.length) return { findings, limitations: ['No projects to analyse.'] };
  const healthy: ProjectFacts[] = [];

  for (const p of input.projects) {
    const ref = [{ type: 'project' as const, id: p.id, name: p.name }];
    const base = { section: 'projects' as const, period, refs: ref };
    const before = findings.length;
    const b = p.budget;
    if (b?.state === 'exceeded') {
      findings.push({
        ...base,
        id: findingId('projects', 'budget_exceeded', p.id),
        category: 'budget_exceeded',
        severity: 'warning',
        basis: 'fact',
        title: `${p.name} is over budget`,
        summary: `${p.name} has used ${b.pctUsed} % of its ${b.kind === 'HOURS' ? 'hours' : 'money'} budget.`,
        metrics: [{ label: 'Budget used', value: b.pctUsed, unit: 'percent' }],
        links: ['projects', 'finance.budgets'],
        next_step: 'Agree a new budget with the client, or narrow the remaining work.',
      });
    } else if (b?.state === 'warning') {
      findings.push({
        ...base,
        id: findingId('projects', 'budget_near', p.id),
        category: 'budget_near',
        severity: 'attention',
        basis: 'fact',
        title: `${p.name} is near its budget`,
        summary: `${p.name} has used ${b.pctUsed} % of its ${b.kind === 'HOURS' ? 'hours' : 'money'} budget.`,
        metrics: [{ label: 'Budget used', value: b.pctUsed, unit: 'percent' }],
        links: ['projects', 'finance.budgets'],
        next_step: 'Review what is left to do against what is left in the budget.',
      });
    } else if (b && b.projectedPct !== null && b.projectedPct > 100) {
      findings.push({
        ...base,
        id: findingId('projects', 'budget_projection', p.id),
        category: 'budget_projection',
        severity: 'attention',
        basis: 'estimate',
        title: `${p.name} may run over budget`,
        summary: `At the current pace, this project is projected to use about ${b.projectedPct} % of its budget by the end of the budget period. It has used ${b.pctUsed} % so far. This is an estimate, not a certainty.`,
        metrics: [
          { label: 'Budget used', value: b.pctUsed, unit: 'percent' },
          { label: 'Projected use', value: b.projectedPct, unit: 'percent' },
        ],
        links: ['projects', 'finance.budgets'],
        next_step: 'Check the burn rate with the team before it becomes an overrun.',
      });
    }

    if (p.tasks.overdue > 0 || p.milestones.overdue > 0) {
      findings.push({
        ...base,
        id: findingId('projects', 'overdue_work', p.id),
        category: 'overdue_work',
        severity: 'attention',
        basis: 'fact',
        title: `Overdue work on ${p.name}`,
        summary: `${p.tasks.overdue} ${p.tasks.overdue === 1 ? 'task is' : 'tasks are'} and ${p.milestones.overdue} ${p.milestones.overdue === 1 ? 'milestone is' : 'milestones are'} past their due date and not done.`,
        metrics: [
          { label: 'Overdue tasks', value: p.tasks.overdue, unit: 'count' },
          { label: 'Overdue milestones', value: p.milestones.overdue, unit: 'count' },
        ],
        links: ['projects', 'tasks'],
        next_step: 'Update the due dates, or reassign the work.',
      });
    }

    const effort = percentChange(p.hoursThisPeriod, p.hoursPreviousPeriod, 1);
    if (p.tasks.dueNext14 >= 3 && effort !== null && effort <= -30) {
      findings.push({
        ...base,
        id: findingId('projects', 'deadline_risk', p.id),
        category: 'deadline_risk',
        severity: 'attention',
        basis: 'estimate',
        title: `${p.name} may miss upcoming due dates`,
        summary: `${p.tasks.dueNext14} tasks are due in the next 14 days while time on the project fell ${Math.abs(effort)} % on the previous period (${p.hoursThisPeriod} h against ${p.hoursPreviousPeriod} h). This is an estimate based on recent effort.`,
        metrics: [
          { label: 'Tasks due in 14 days', value: p.tasks.dueNext14, unit: 'count' },
          { label: 'Hours', value: p.hoursThisPeriod, unit: 'hours', previous: p.hoursPreviousPeriod },
        ],
        links: ['projects', 'tasks'],
        next_step: 'Confirm who is working on the due tasks this week.',
      });
    }
    // Finish forecast (estimate): a likely late finish needs attention; an on-time one is information
    // and does not stop the project counting as healthy.
    let finish: Finding | null = null;
    if (p.tasksDoneLast28 !== undefined && p.tasks.open > 0) {
      const fc = finishForecast({ open: p.tasks.open, doneLast28: p.tasksDoneLast28, today: input.today, endDate: p.endDate ?? null });
      if (!fc) limitations.push(`Not enough recent progress to estimate when ${p.name} will finish.`);
      else {
        const days = Math.ceil(fc.weeks * 7);
        finish = {
          ...base,
          id: findingId('projects', 'finish_forecast', p.id),
          category: 'finish_forecast',
          severity: fc.late ? 'attention' : 'info',
          basis: 'estimate',
          title: fc.late ? `${p.name} may finish after its end date` : `${p.name} is estimated to finish around ${fc.finishDate}`,
          summary: `At the pace of the last four weeks, the ${p.tasks.open} open tasks would be done around ${fc.finishDate}${fc.late ? `, after the planned end date ${p.endDate}` : ''}. This is an estimate, not a certainty.`,
          metrics: [
            { label: 'Open tasks', value: p.tasks.open, unit: 'count' },
            { label: 'Days to finish', value: days, unit: 'days' },
          ],
          links: ['projects', 'tasks'],
          next_step: fc.late ? 'Review the scope, the end date or who works on it.' : 'No action needed.',
        };
        if (fc.late) findings.push(finish);
      }
    }
    if (findings.length === before) healthy.push(p);
    if (finish && finish.severity === 'info') findings.push(finish);
  }

  if (healthy.length) {
    const names = healthy.slice(0, MAX_HEALTHY_NAMES).map((p) => p.name);
    const more = healthy.length - names.length;
    findings.push({
      section: 'projects',
      period,
      id: findingId('projects', 'healthy', period.from),
      category: 'healthy',
      severity: 'info',
      basis: 'observation',
      title: `${healthy.length} ${healthy.length === 1 ? 'project shows' : 'projects show'} no warning signs`,
      summary: `No budget, overdue or deadline concerns for ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}.`,
      metrics: [{ label: 'Projects', value: healthy.length, unit: 'count' }],
      refs: healthy.slice(0, MAX_HEALTHY_NAMES).map((p) => ({ type: 'project' as const, id: p.id, name: p.name })),
      links: ['projects'],
      next_step: 'No action needed.',
    });
  }
  return { findings, limitations };
}
