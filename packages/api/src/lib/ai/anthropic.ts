import Anthropic from '@anthropic-ai/sdk';
import { AiError, type AiChunk, type AiProvider, type AiTurnInput } from './provider';

/** The slice of the SDK client this provider uses; tests inject a fake. */
export interface AnthropicLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: { create(params: any, options?: any): PromiseLike<AsyncIterable<any>> };
}

function toAiError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  if (e instanceof Anthropic.APIConnectionError) return new AiError('ai_unavailable');
  if (e instanceof SyntaxError) return new AiError('ai_bad_response');
  const { status, type } = (e as { status?: unknown; type?: unknown } | null) ?? {};
  // The SDK throws an APIError (status undefined, type set) for an SSE error event.
  if (status === 429 || status === 529 || type === 'overloaded_error' || type === 'rate_limit_error') return new AiError('ai_rate_limited');
  return new AiError('ai_unavailable');
}

function isAbort(e: unknown, signal: AbortSignal): boolean {
  return signal.aborted || e instanceof Anthropic.APIUserAbortError;
}

export class AnthropicProvider implements AiProvider {
  readonly available = true;
  private readonly client: AnthropicLike;

  constructor(
    apiKey: string,
    private readonly model: string,
    client?: AnthropicLike,
  ) {
    this.client = client ?? (new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 }) as unknown as AnthropicLike);
  }

  async *streamTurn(i: AiTurnInput): AsyncIterable<AiChunk> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let stream: AsyncIterable<any>;
    try {
      stream = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: i.maxTokens,
          system: i.system,
          stream: true,
          messages: i.messages.map((m) => ({ role: m.role, content: m.content })),
          tools: i.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
          ...(i.toolChoice === 'none' ? { tool_choice: { type: 'none' } } : {}),
        },
        { signal: i.signal },
      );
    } catch (e) {
      if (isAbort(e, i.signal)) return;
      throw toAiError(e);
    }

    const tools = new Map<number, { id: string; name: string; json: string }>();
    const thinking = new Map<number, { thinking: string; signature: string }>();
    let inputTokens = 0;
    let outputTokens = 0;
    let stopped = false;
    try {
      for await (const ev of stream) {
        if (i.signal.aborted) return;
        switch (ev?.type) {
          case 'message_start':
            inputTokens = ev.message?.usage?.input_tokens ?? 0;
            outputTokens = ev.message?.usage?.output_tokens ?? 0;
            break;
          case 'content_block_start':
            if (ev.content_block?.type === 'tool_use') tools.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: '' });
            else if (ev.content_block?.type === 'thinking') thinking.set(ev.index, { thinking: ev.content_block.thinking ?? '', signature: ev.content_block.signature ?? '' });
            else if (ev.content_block?.type === 'redacted_thinking') yield { type: 'redacted_thinking', data: ev.content_block.data };
            break;
          case 'content_block_delta':
            if (ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') yield { type: 'text_delta', text: ev.delta.text };
            else if (ev.delta?.type === 'thinking_delta') {
              const t = thinking.get(ev.index);
              if (t) t.thinking += ev.delta.thinking ?? '';
            } else if (ev.delta?.type === 'signature_delta') {
              const t = thinking.get(ev.index);
              if (t) t.signature = ev.delta.signature ?? '';
            } else if (ev.delta?.type === 'input_json_delta') {
              const t = tools.get(ev.index);
              if (t) t.json += ev.delta.partial_json ?? '';
            }
            break;
          case 'content_block_stop': {
            const th = thinking.get(ev.index);
            if (th) {
              thinking.delete(ev.index);
              yield { type: 'thinking', thinking: th.thinking, signature: th.signature };
            }
            const t = tools.get(ev.index);
            if (t) {
              tools.delete(ev.index);
              let input: unknown;
              try {
                input = t.json.trim() === '' ? {} : JSON.parse(t.json);
              } catch {
                throw new AiError('ai_bad_response');
              }
              yield { type: 'tool_use', id: t.id, name: t.name, input };
            }
            break;
          }
          case 'message_delta': {
            if (typeof ev.usage?.output_tokens === 'number') outputTokens = ev.usage.output_tokens;
            const reason = ev.delta?.stop_reason;
            if (reason) {
              yield { type: 'usage', inputTokens, outputTokens };
              yield { type: 'stop', reason: reason === 'tool_use' ? 'tool_use' : reason === 'max_tokens' ? 'max_tokens' : 'end_turn' };
              stopped = true;
            }
            break;
          }
        }
      }
    } catch (e) {
      if (isAbort(e, i.signal)) return;
      throw toAiError(e);
    }
    if (i.signal.aborted) return;
    if (!stopped) throw new AiError('ai_bad_response');
  }
}
