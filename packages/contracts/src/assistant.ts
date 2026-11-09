import { z } from 'zod';
import { id, isoDate, nonEmpty } from './common';
import { NAV_TARGET_KEYS } from '@tallywork/domain/assistant';

// ─── Inputs ──────────────────────────────────────────────────────────────────
export const assistantSendInput = z.object({
  content: nonEmpty(4000),
  /** The page the member is on, used only as context. */
  route: z.string().max(200).optional(),
});

export const assistantRenameInput = z.object({ title: nonEmpty(120) });

export const assistantCreateInput = z.object({ title: nonEmpty(120).optional() });

// ─── DTOs ────────────────────────────────────────────────────────────────────
export interface AssistantConversationDto {
  id: string;
  title: string;
  created_at: string;
  last_message_at: string | null;
}

export interface AssistantToolCallDto {
  name: string;
  status: 'ok' | 'denied' | 'error';
}

export interface AssistantMessageDto {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls: AssistantToolCallDto[];
  /** Resolved again on every read, so it always reflects the member's current permissions. */
  nav: Array<{ key: string; label: string; href: string }>;
  error_code: string | null;
  created_at: string;
}

// ─── Stream events (SSE) ─────────────────────────────────────────────────────
export const ASSISTANT_ERROR_CODES = ['ai_unavailable', 'ai_rate_limited', 'ai_bad_response', 'interrupted', 'timeout', 'internal'] as const;
export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];

export const assistantStreamEvent = z.discriminatedUnion('event', [
  z.object({ event: z.literal('message_saved'), data: z.object({ user_message_id: id }) }),
  z.object({ event: z.literal('delta'), data: z.object({ text: z.string() }) }),
  z.object({
    event: z.literal('tool_status'),
    data: z.object({ tool: z.string(), state: z.enum(['running', 'done', 'denied', 'error']) }),
  }),
  z.object({ event: z.literal('nav'), data: z.object({ key: z.string(), label: z.string(), href: z.string() }) }),
  z.object({ event: z.literal('done'), data: z.object({ assistant_message_id: id }) }),
  z.object({ event: z.literal('error'), data: z.object({ code: z.enum(ASSISTANT_ERROR_CODES), retryable: z.boolean() }) }),
]);
export type AssistantStreamEvent = z.infer<typeof assistantStreamEvent>;

// ─── AI Insights ─────────────────────────────────────────────────────────────
/** The AI Insights page and tools: findings computed in code (never by the model), see @tallywork/domain/insights. */
export const insightSectionInput = z.enum(['overview', 'workforce', 'timesheets', 'projects', 'workflow']);
export type InsightSectionParam = z.infer<typeof insightSectionInput>;

const MAX_INSIGHT_DAYS = 93;
export const insightQueryInput = z
  .object({ from: isoDate, to: isoDate })
  .refine((q) => q.to >= q.from, { message: 'The end must be on or after the start', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 + 1 <= MAX_INSIGHT_DAYS, { message: `At most ${MAX_INSIGHT_DAYS} days`, path: ['to'] });

const period = z.object({ from: isoDate, to: isoDate });
export const insightFindingSchema = z.object({
  id: z.string().max(400),
  section: z.enum(['workforce', 'timesheets', 'projects', 'workflow']),
  category: z.string().max(60),
  severity: z.enum(['info', 'attention', 'warning']),
  basis: z.enum(['fact', 'observation', 'estimate']),
  title: z.string().max(300),
  summary: z.string().max(2000),
  period,
  metrics: z.array(z.object({ label: z.string().max(80), value: z.number().finite(), unit: z.enum(['hours', 'percent', 'count', 'days']), previous: z.number().finite().nullable().optional() })).max(10),
  refs: z.array(z.object({ type: z.enum(['member', 'team', 'project', 'timesheet', 'task']), id: z.string().max(200), name: z.string().max(200) })).max(25),
  links: z.array(z.enum(NAV_TARGET_KEYS as [string, ...string[]])).max(5),
  next_step: z.string().max(500),
});
export const insightResultSchema = z.object({
  section: insightSectionInput,
  period,
  previous: period,
  findings: z.array(insightFindingSchema).max(200),
  limitations: z.array(z.string().max(300)).max(20),
});
export type InsightFindingDto = z.infer<typeof insightFindingSchema>;
export type InsightResultDto = z.infer<typeof insightResultSchema>;

// ─── Drafts ──────────────────────────────────────────────────────────────────
/** WorkPulse AI drafts: text the person edits and sends themselves. Nothing is stored, sent or published. */
export const DRAFT_STYLES = ['improve', 'shorter', 'longer', 'professional', 'friendly', 'translate'] as const;
export const assistantDraftInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project_description'), project_id: id }),
  z.object({ kind: z.literal('task_description'), task_id: id }),
  z.object({ kind: z.literal('timesheet_reminder'), from: isoDate, to: isoDate }),
  z.object({ kind: z.literal('project_update'), project_id: id, from: isoDate, to: isoDate }),
  z.object({ kind: z.literal('rewrite'), text: nonEmpty(4000), style: z.enum(DRAFT_STYLES), language: z.string().trim().min(2).max(40).optional() }),
]);
export type AssistantDraftInput = z.infer<typeof assistantDraftInput>;
export interface AssistantDraftDto {
  text: string;
  /** The facts the draft was written from, so the person can check it. */
  facts_used: string[];
}
