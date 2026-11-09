import type { AssistantStreamEvent } from '@tallywork/contracts';
import { api } from '@/lib/api';
import { createSseParser } from './sse';

/**
 * Sends one message and reads the reply stream. Errors before the stream starts (429, 409, 400,
 * 404) are thrown as ApiError by `api`; errors during the stream arrive as `error` events.
 * Resolves true when the turn ended with `done` or `error`, false when the connection closed first.
 */
export async function streamAssistantMessage(
  orgId: string,
  conversationId: string,
  input: { content: string; route?: string },
  onEvent: (e: AssistantStreamEvent) => void,
  signal: AbortSignal,
): Promise<boolean> {
  const res = await api<Response>(`/orgs/${orgId}/assistant/conversations/${conversationId}/messages`, { body: input, signal, raw: true });
  if (!res.body) return false;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // `done` and `error` end the turn: stop reading there rather than waiting for the connection to
  // close, which a proxy or dev server may hold open.
  let finished = false;
  const feed = createSseParser((e) => {
    if (finished) return;
    onEvent(e);
    if (e.event === 'done' || e.event === 'error') finished = true;
  });
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(decoder.decode(value, { stream: true }));
    }
    if (!finished) feed(decoder.decode() + '\n\n');
  } finally {
    if (finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return finished;
}
