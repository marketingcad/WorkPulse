import type { z } from 'zod';
import { resolveNav } from '@tallywork/domain/assistant';
import type { InsightResultDto } from '@tallywork/contracts';
import { getInsights } from '../../ai-insights';
import type { Ctx } from '../../ctx';
import { redactFinding } from '../redact';
import { dateRange, has } from './shared';
import type { AssistantTool, NavLink } from './types';

/**
 * The AI Insights findings as assistant tools. Every number comes from the same computed findings
 * as the AI Insights page; the model explains them and suggests next steps.
 */
const input = dateRange({});

const RANK = { warning: 0, attention: 1, info: 2 } as const;
type Redacted = ReturnType<typeof redactFinding>;

/**
 * The most important findings that fit in `maxBytes` of JSON (the tool result is capped at 8 KB and
 * replaced wholesale when over it), warnings first, with how many were left out.
 */
export function fitFindings(findings: Redacted[], maxBytes: number): { findings: Redacted[]; omitted: number } {
  const sorted = [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  const out: Redacted[] = [];
  let size = Buffer.byteLength(JSON.stringify({ findings: [], omitted: findings.length }));
  for (const f of sorted) {
    const add = Buffer.byteLength(JSON.stringify(f)) + 1;
    if (size + add > maxBytes) break;
    out.push(f);
    size += add;
  }
  return { findings: out, omitted: findings.length - out.length };
}

function toToolOutput(x: Ctx, r: InsightResultDto): { data: unknown; nav: NavLink[] } {
  const nav = new Map<string, NavLink>();
  for (const f of r.findings) for (const k of f.links) {
    const link = resolveNav(x.actor.grants, x.org.id, k);
    if (link) nav.set(link.key, link);
  }
  return {
    data: { period: r.period, previous_period: r.previous, ...fitFindings(r.findings.map(redactFinding), 6500), limitations: r.limitations },
    nav: [...nav.values()].slice(0, 4),
  };
}

const insightTool = (name: string, section: 'workforce' | 'timesheets' | 'projects', description: string, gate: Parameters<typeof has>[1], statusKey: string): AssistantTool<z.infer<typeof input>> => ({
  name,
  description,
  input,
  allowed: (a) => has(a, gate),
  statusKey,
  run: async (x, q) => toToolOutput(x, await getInsights(x, section, q)),
});

export const workforceInsightsTool = insightTool(
  'getWorkforceInsights',
  'workforce',
  'Workforce insights for a date range (at most 93 days) compared with the previous period of the same length: hours trend, overtime and workload by team, approved share, approvals waiting, missing timesheets and time off. Each finding has a basis: fact, observation (comparison) or estimate.',
  'time:read',
  'checking_workforce',
);

export const checkTimesheetsTool = insightTool(
  'checkTimesheets',
  'timesheets',
  'Timesheets that may need a look in a date range: overlapping or repeated entries, very long days, mostly manual time, large changes against the previous period, flags from the approval queue and timesheets not submitted. Never approves or changes anything.',
  'timesheets:read',
  'reviewing_timesheets',
);

export const projectRisksTool = insightTool(
  'getProjectRisks',
  'projects',
  'Project health for a date range: budgets exceeded or near their limit, budget projections (estimates), overdue tasks and milestones, and possible deadline risks (estimates), plus projects with no warning signs.',
  'projects:read',
  'checking_project_risks',
);

export const workflowInsightsTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getWorkflowInsights',
  description:
    'Approval workflow for a date range: what waits for the person to decide (timesheets, manual time, time off, expenses) in a suggested review order, what has waited more than 3 days, and the average days to decide a timesheet against the previous period. Never approves or changes anything.',
  input,
  allowed: (a) => has(a, 'timesheets:approve') || has(a, 'manual_time:approve') || has(a, 'time_off:approve') || has(a, 'expenses:approve'),
  statusKey: 'checking_workflow',
  run: async (x, q) => toToolOutput(x, await getInsights(x, 'workflow', q)),
};

/** Finance roles only (payroll, invoices, payments, billing or rates); every use is audited by the section. */
export const financialInsightsTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getFinancialInsights',
  description:
    'Payroll and billing for people with finance access: payroll compared with the run before (per currency), overtime hours in payroll, an estimate of the current period\'s pay from approved and unapproved time (labelled an estimate; the payroll run stays the official figure), overdue invoices and payments received. Amounts are minor units with their currency.',
  input,
  allowed: (a) => has(a, 'payroll:read') || has(a, 'invoices:read') || has(a, 'payments:read') || has(a, 'billing:read') || has(a, 'rates:read'),
  statusKey: 'checking_finance',
  run: async (x, q) => toToolOutput(x, await getInsights(x, 'finance', q)),
};
