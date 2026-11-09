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
  readonly calls: Array<{ system: string; messages: AiMessage[]; tools: AiToolSpec[]; toolChoice?: 'auto' | 'none' }> = [];
  private queue: AiChunk[][] = [];
  private seq = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  script(turns: AiChunk[][]): void {
    this.queue = [...turns];
  }

  async *streamTurn(i: AiTurnInput): AsyncIterable<AiChunk> {
    this.calls.push(structuredClone({ system: i.system, messages: i.messages, tools: i.tools, ...(i.toolChoice ? { toolChoice: i.toolChoice } : {}) }));
    // A draft (services/assistant/drafts.ts, DRAFT_SYSTEM) gets plain text; everything else the rules.
    const chunks = this.queue.length ? this.queue.shift()! : i.system.startsWith('Write the requested text for WorkPulse users.') ? this.draft(i.messages) : this.respond(i.messages);
    for (const chunk of chunks) {
      if (i.signal.aborted) return;
      yield chunk;
    }
  }

  /** No tools offered (a draft): plain text "Draft: <first line of the instruction>". "error-test" fails. */
  private draft(messages: AiMessage[]): AiChunk[] {
    const text = lastText(messages);
    if (text.toLowerCase().includes('error-test')) throw new AiError('ai_unavailable');
    return [
      { type: 'text_delta', text: `Draft: ${text.split('\n')[0]!.slice(0, 60)}` },
      { type: 'usage', inputTokens: 10, outputTokens: 5 },
      { type: 'stop', reason: 'end_turn' },
    ];
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
    // Insight tools (AI Insights): checked before the plainer keywords below.
    if (lower.includes('bottleneck') || lower.includes('waiting for')) return tool('getWorkflowInsights', { from: mondayUtc(this.now()), to: this.now().toISOString().slice(0, 10) });
    if (lower.includes('review')) return tool('checkTimesheets', { from: mondayUtc(this.now()), to: this.now().toISOString().slice(0, 10) });
    if (lower.includes('insight')) return tool('getWorkforceInsights', { from: mondayUtc(this.now()), to: this.now().toISOString().slice(0, 10) });
    if (lower.includes('risk')) return tool('getProjectRisks', { from: mondayUtc(this.now()), to: this.now().toISOString().slice(0, 10) });
    if (lower.includes('report')) return tool('summarizeReport', { key: 'time-activity', from: mondayUtc(this.now()), to: this.now().toISOString().slice(0, 10) });
    if (lower.includes('hours')) {
      const now = this.now();
      return tool('getHoursSummary', { from: mondayUtc(now), to: now.toISOString().slice(0, 10), group: 'member' });
    }
    if (lower.includes('budget')) return tool('getProjectBudgetSummary', {});
    if (lower.includes('approv')) return tool('suggestNavigation', { key: 'timesheets.approvals' });
    return tool('searchWorkPulseDocumentation', { query: text.slice(0, 200) });
  }
}
