import { AiError, type AiBlock, type AiChunk, type AiMessage, type AiProvider, type AiToolSpec, type AiTurnInput } from './provider';

function lastText(messages: AiMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const blocks = last?.content.filter((b): b is Extract<AiBlock, { type: 'text' }> => b.type === 'text') ?? [];
  return blocks.map((b) => b.text).join('\n');
}

function mondayUtc(d: Date): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const back = (copy.getUTCDay() + 6) % 7;
  copy.setUTCDate(copy.getUTCDate() - back);
  return copy.toISOString().slice(0, 10);
}

/** Deterministic provider for tests, E2E and local development without a key. */
export class FakeProvider implements AiProvider {
  readonly available = true;
  readonly calls: Array<{ system: string; messages: AiMessage[]; tools: AiToolSpec[] }> = [];
  private queue: AiChunk[][] = [];
  private seq = 0;

  script(turns: AiChunk[][]): void {
    this.queue = [...turns];
  }

  async *streamTurn(i: AiTurnInput): AsyncIterable<AiChunk> {
    this.calls.push({ system: i.system, messages: i.messages, tools: i.tools });
    const chunks = this.queue.length ? this.queue.shift()! : this.respond(i.messages);
    for (const chunk of chunks) {
      if (i.signal.aborted) return;
      yield chunk;
    }
  }

  private respond(messages: AiMessage[]): AiChunk[] {
    const last = messages[messages.length - 1];
    const results = last?.content.filter((b): b is Extract<AiBlock, { type: 'tool_result' }> => b.type === 'tool_result') ?? [];
    if (results.length) {
      const text = 'Here is what I found: ' + results.map((r) => r.content).join('\n').slice(0, 400);
      const words = text.split(' ');
      return [
        ...words.map((w, n): AiChunk => ({ type: 'text_delta', text: n === 0 ? w : ' ' + w })),
        { type: 'usage', inputTokens: 10, outputTokens: words.length },
        { type: 'stop', reason: 'end_turn' },
      ];
    }
    const text = lastText(messages);
    const lower = text.toLowerCase();
    const id = `toolu_fake_${++this.seq}`;
    const tool = (name: string, input: unknown): AiChunk[] => [
      { type: 'tool_use', id, name, input },
      { type: 'usage', inputTokens: 10, outputTokens: 5 },
      { type: 'stop', reason: 'tool_use' },
    ];
    if (lower.includes('error-test')) throw new AiError('ai_unavailable');
    if (lower.includes('hours')) {
      const now = new Date();
      return tool('getHoursSummary', { from: mondayUtc(now), to: now.toISOString().slice(0, 10), group: 'member' });
    }
    if (lower.includes('budget')) return tool('getProjectBudgetSummary', {});
    if (lower.includes('approv')) return tool('suggestNavigation', { key: 'timesheets.approvals' });
    return tool('searchWorkPulseDocumentation', { query: text.slice(0, 200) });
  }
}
