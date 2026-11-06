import { z } from 'zod';
import { id, nonEmpty } from './common';

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
    data: z.object({ tool: z.string(), state: z.enum(['running', 'done', 'denied']) }),
  }),
  z.object({ event: z.literal('nav'), data: z.object({ key: z.string(), label: z.string(), href: z.string() }) }),
  z.object({ event: z.literal('done'), data: z.object({ assistant_message_id: id }) }),
  z.object({ event: z.literal('error'), data: z.object({ code: z.enum(ASSISTANT_ERROR_CODES), retryable: z.boolean() }) }),
]);
export type AssistantStreamEvent = z.infer<typeof assistantStreamEvent>;
