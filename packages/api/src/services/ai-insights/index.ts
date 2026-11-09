import { localDate } from '@tallywork/domain';
import { capFindings, financeFindings, previousPeriod, projectFindings, timesheetFindings, workflowFindings, workforceFindings, type Finding, type InsightSection, type Period } from '@tallywork/domain/insights';
import { insightResultSchema, type InsightResultDto, type InsightSectionParam } from '@tallywork/contracts';
import type { Ctx } from '../ctx';
import { insightCache, insightCacheKey } from './cache';
import { financeInputs, mayReadFinance } from './finance-inputs';
import { audit } from '../events';
import { projectInputs, timesheetInputs, workflowInputs, workforceInputs } from './gather';

/**
 * WorkPulse AI Insights: findings computed in code from what this person may see. No AI provider is
 * involved here: the page works without one, and the assistant's tools explain these same findings.
 */

const has = (x: Ctx, p: string) => x.actor.grants[p as keyof typeof x.actor.grants] !== undefined;
const SEVERITY = { warning: 0, attention: 1, info: 2 } as const;
const SECTIONS: InsightSection[] = ['workforce', 'timesheets', 'projects', 'workflow'];
const OVERVIEW_MAX = 6;
/** Per section: the most important findings, with a note when more were found (bounded output). */
const SECTION_MAX = 50;

type Part = { findings: Finding[]; limitations: string[] };

async function section(x: Ctx, s: InsightSection, period: Period, previous: Period, today: string): Promise<Part> {
  if (s === 'workforce') {
    if (!has(x, 'time:read')) return { findings: [], limitations: ['Workforce insights need access to time entries.'] };
    const input = await workforceInputs(x, period, previous, today);
    return workforceFindings({ period, previous, ...input });
  }
  if (s === 'timesheets') {
    if (!has(x, 'timesheets:read')) return { findings: [], limitations: ['Timesheet insights need access to timesheets.'] };
    const input = await timesheetInputs(x, period, previous, today);
    return { findings: timesheetFindings({ period, entries: input.entries, sheets: input.sheets, missing: input.missing, dayOf: input.dayOf }), limitations: input.limitations };
  }
  if (s === 'finance') {
    // Each part only with its own permission; without any, no data is read and nothing is audited.
    if (!mayReadFinance(x)) return { findings: [], limitations: ['Payroll insights need payroll access.', 'Invoice and payment insights need invoice or payment access.'] };
    const input = await financeInputs(x, period, previous, today);
    // Sensitive data: every computation is audited (which section and period; never amounts).
    await audit(x, { action: 'insights.finance_viewed', targetType: 'insights', metadata: { section: 'finance', from: period.from, to: period.to } });
    return financeFindings({ period, previous, ...input });
  }
  if (s === 'workflow') {
    const input = await workflowInputs(x, period, previous, today);
    const r = workflowFindings({ period, today, waiting: input.waiting, decisionDays: input.decisionDays });
    return { findings: r.findings, limitations: [...input.limitations, ...r.limitations] };
  }
  if (!has(x, 'projects:read')) return { findings: [], limitations: ['Project insights need access to projects.'] };
  const input = await projectInputs(x, period, previous, today);
  const r = projectFindings({ period, today, projects: input.projects });
  return { findings: r.findings, limitations: [...input.limitations, ...r.limitations] };
}

const bySeverity = (a: Finding, b: Finding) => SEVERITY[a.severity] - SEVERITY[b.severity] || SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section);

export async function getInsights(x: Ctx, which: InsightSectionParam, q: Period): Promise<InsightResultDto> {
  const key = insightCacheKey(x.org.id, x.actor.membershipId, which, q.from, q.to);
  const now = x.deps.now().getTime();
  const cached = insightCache.get(key, now);
  if (cached) return cached;

  const today = localDate(x.deps.now(), x.org.timezone);
  // A period that runs past today is measured up to today, and compared with the same number of
  // days just before it: a partial week is never compared with a whole one.
  const future = q.from > today;
  const period = { from: q.from, to: future ? q.from : q.to > today ? today : q.to };
  const previous = previousPeriod(period.from, period.to);
  let part: Part;
  if (future) part = { findings: [], limitations: ['This period has not started yet.'] };
  else if (which === 'overview') {
    const parts: Part[] = [];
    for (const s of SECTIONS) parts.push(await section(x, s, period, previous, today));
    part = {
      findings: parts.flatMap((p) => p.findings).sort(bySeverity).slice(0, OVERVIEW_MAX),
      limitations: [...new Set(parts.flatMap((p) => p.limitations))],
    };
  } else {
    const r = await section(x, which, period, previous, today);
    const capped = capFindings(r.findings, SECTION_MAX);
    part = { findings: capped.findings, limitations: capped.limitation ? [...r.limitations, capped.limitation] : r.limitations };
  }

  // The contract is the gate on what leaves the service: a malformed finding fails loudly here.
  const result = insightResultSchema.parse({ section: which, period, previous, findings: part.findings, limitations: part.limitations.slice(0, 20) });
  insightCache.set(key, result, now);
  return result;
}
