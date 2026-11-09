import { localDate } from '@tallywork/domain';
import { previousPeriod, projectFindings, timesheetFindings, workforceFindings, type Finding, type InsightSection, type Period } from '@tallywork/domain/insights';
import { insightResultSchema, type InsightResultDto, type InsightSectionParam } from '@tallywork/contracts';
import type { Ctx } from '../ctx';
import { insightCache, insightCacheKey } from './cache';
import { projectInputs, timesheetInputs, workforceInputs } from './gather';

/**
 * WorkPulse AI Insights: findings computed in code from what this person may see. No AI provider is
 * involved here: the page works without one, and the assistant's tools explain these same findings.
 */

const has = (x: Ctx, p: string) => x.actor.grants[p as keyof typeof x.actor.grants] !== undefined;
const SEVERITY = { warning: 0, attention: 1, info: 2 } as const;
const SECTIONS: InsightSection[] = ['workforce', 'timesheets', 'projects'];
const OVERVIEW_MAX = 6;

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

  const previous = previousPeriod(q.from, q.to);
  const today = localDate(x.deps.now(), x.org.timezone);
  let part: Part;
  if (which === 'overview') {
    const parts: Part[] = [];
    for (const s of SECTIONS) parts.push(await section(x, s, q, previous, today));
    part = {
      findings: parts.flatMap((p) => p.findings).sort(bySeverity).slice(0, OVERVIEW_MAX),
      limitations: [...new Set(parts.flatMap((p) => p.limitations))],
    };
  } else part = await section(x, which, q, previous, today);

  // The contract is the gate on what leaves the service: a malformed finding fails loudly here.
  const result = insightResultSchema.parse({ section: which, period: q, previous, findings: part.findings, limitations: part.limitations.slice(0, 20) });
  insightCache.set(key, result, now);
  return result;
}
