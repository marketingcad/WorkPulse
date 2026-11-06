import type { AssistantStreamEvent } from '@tallywork/contracts';
import { api } from '@/lib/api';
import { createSseParser } from './sse';

/**
 * Sends one message and reads the reply stream. Errors before the stream starts (429, 409, 400,
 * 404) are thrown as ApiError by `api`; errors during the stream arrive as `error` events.
 */
export async function streamAssistantMessage(
  orgId: string,
  conversationId: string,
  input: { content: string; route?: string },
  onEvent: (e: AssistantStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await api<Response>(`/orgs/${orgId}/assistant/conversations/${conversationId}/messages`, { body: input, signal, raw: true });
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const feed = createSseParser(onEvent);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      feed(decoder.decode(value, { stream: true }));
    }
    feed(decoder.decode() + '\n\n');
  } finally {
    reader.releaseLock();
  }
}
