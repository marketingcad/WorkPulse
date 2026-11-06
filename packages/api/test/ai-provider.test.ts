import { describe, expect, it } from 'vitest';
import { AiError, AnthropicProvider, FakeProvider, createAiProvider, type AiChunk, type AiMessage } from '../src/lib/ai';
import { loadConfig } from '../src/config';

const userMsg = (text: string): AiMessage[] => [{ role: 'user', content: [{ type: 'text', text }] }];
const run = (p: { streamTurn: FakeProvider['streamTurn'] }, messages: AiMessage[], signal = new AbortController().signal) =>
  p.streamTurn({ system: 's', messages, tools: [], maxTokens: 100, signal });
async function collect(it: AsyncIterable<AiChunk>): Promise<AiChunk[]> {
  const out: AiChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}
const toolOf = (chunks: AiChunk[]) => chunks.find((c) => c.type === 'tool_use') as Extract<AiChunk, { type: 'tool_use' }>;

describe('createAiProvider', () => {
  it('falls back to the fake provider with no key', () => {
    expect(createAiProvider({})).toBeInstanceOf(FakeProvider);
  });
  it('is unavailable in production without a key', async () => {
    const p = createAiProvider({ NODE_ENV: 'production' });
    expect(p.available).toBe(false);
    await expect(collect(run(p, userMsg('hi')))).rejects.toMatchObject({ code: 'ai_unavailable' });
  });
  it('uses Anthropic with a key unless disabled', () => {
    expect(createAiProvider({ ANTHROPIC_API_KEY: 'sk-ant-x' })).toBeInstanceOf(AnthropicProvider);
    expect(createAiProvider({ ANTHROPIC_API_KEY: 'sk-ant-x', ASSISTANT_ENABLED: 'false' })).toBeInstanceOf(FakeProvider);
  });
  it('never puts the key in Config', () => {
    const cfg = loadConfig({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'sk-ant-secret' });
    expect(JSON.stringify(cfg)).not.toContain('sk-ant-secret');
    expect(cfg.assistantModel).toBe('claude-sonnet-5-5');
    expect(cfg.assistantEnabled).toBe(true);
  });
});

describe('AnthropicProvider', () => {
  const fakeClient = (create: () => Promise<AsyncIterable<unknown>>) => ({ messages: { create } });
  const stream = (events: unknown[]) => async () =>
    (async function* () {
      for (const e of events) yield e;
    })();

  it('maps a 429 to ai_rate_limited with a fixed message', async () => {
    const err = Object.assign(new Error('rate limit sk-ant-leak for org'), { status: 429 });
    const p = new AnthropicProvider('sk-ant-key', 'm', fakeClient(() => Promise.reject(err)));
    const e = await collect(run(p, userMsg('hi'))).catch((x) => x);
    expect(e).toBeInstanceOf(AiError);
    expect(e.code).toBe('ai_rate_limited');
    expect(e.message).not.toContain('sk-');
    expect(e.message).not.toContain('rate limit sk-ant-leak');
  });
  it('maps 5xx to ai_unavailable and overloaded to ai_rate_limited', async () => {
    const mk = (status: number) => new AnthropicProvider('k', 'm', fakeClient(() => Promise.reject(Object.assign(new Error('x'), { status }))));
    await expect(collect(run(mk(503), userMsg('hi')))).rejects.toMatchObject({ code: 'ai_unavailable' });
    await expect(collect(run(mk(529), userMsg('hi')))).rejects.toMatchObject({ code: 'ai_rate_limited' });
  });
  it('turns stream events into chunks', async () => {
    const p = new AnthropicProvider(
      'k',
      'm',
      fakeClient(
        stream([
          { type: 'message_start', message: { usage: { input_tokens: 7, output_tokens: 1 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'getHoursSummary' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"from":' } },
          { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"2026-01-05"}' } },
          { type: 'content_block_stop', index: 1 },
          { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 20 } },
        ]),
      ),
    );
    expect(await collect(run(p, userMsg('hi')))).toEqual([
      { type: 'text_delta', text: 'Hi' },
      { type: 'tool_use', id: 'tu1', name: 'getHoursSummary', input: { from: '2026-01-05' } },
      { type: 'usage', inputTokens: 7, outputTokens: 20 },
      { type: 'stop', reason: 'tool_use' },
    ]);
  });
  it('maps invalid tool JSON and a truncated stream to ai_bad_response', async () => {
    const badJson = new AnthropicProvider(
      'k',
      'm',
      fakeClient(
        stream([
          { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'x' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":' } },
          { type: 'content_block_stop', index: 0 },
        ]),
      ),
    );
    await expect(collect(run(badJson, userMsg('hi')))).rejects.toMatchObject({ code: 'ai_bad_response' });
    const truncated = new AnthropicProvider('k', 'm', fakeClient(stream([{ type: 'message_start', message: { usage: {} } }])));
    await expect(collect(run(truncated, userMsg('hi')))).rejects.toMatchObject({ code: 'ai_bad_response' });
  });
  it('maps an in-stream overloaded error event', async () => {
    const p = new AnthropicProvider('k', 'm', fakeClient(stream([{ type: 'error', error: { type: 'overloaded_error', message: 'secret' } }])));
    await expect(collect(run(p, userMsg('hi')))).rejects.toMatchObject({ code: 'ai_rate_limited' });
  });
});

describe('FakeProvider', () => {
  it('applies the built-in rules', async () => {
    const f = new FakeProvider();
    const hours = toolOf(await collect(run(f, userMsg('How many HOURS this week?'))));
    expect(hours.name).toBe('getHoursSummary');
    const input = hours.input as { from: string; to: string; group: string };
    expect(input.group).toBe('member');
    expect(new Date(input.from + 'T00:00:00Z').getUTCDay()).toBe(1);
    expect(input.to).toBe(new Date().toISOString().slice(0, 10));
    expect(toolOf(await collect(run(f, userMsg('project budget?')))).name).toBe('getProjectBudgetSummary');
    const nav = toolOf(await collect(run(f, userMsg('where do I approve timesheets'))));
    expect(nav).toMatchObject({ name: 'suggestNavigation', input: { key: 'timesheets.approvals' } });
    const doc = toolOf(await collect(run(f, userMsg('x'.repeat(300)))));
    expect(doc.name).toBe('searchWorkPulseDocumentation');
    expect((doc.input as { query: string }).query).toHaveLength(200);
    await expect(collect(run(f, userMsg('error-test')))).rejects.toMatchObject({ code: 'ai_unavailable' });
    expect(f.calls.length).toBe(5);
  });
  it('answers tool results with split text deltas then end_turn', async () => {
    const f = new FakeProvider();
    const msgs: AiMessage[] = [...userMsg('hours'), { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'a'.repeat(500) + ' b' }] }];
    const chunks = await collect(run(f, msgs));
    const deltas = chunks.filter((c) => c.type === 'text_delta') as Array<{ text: string }>;
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((d) => d.text).join('')).toBe('Here is what I found: ' + 'a'.repeat(400));
    expect(chunks[chunks.length - 1]).toEqual({ type: 'stop', reason: 'end_turn' });
  });
  it('script() overrides the rules, one turn per call', async () => {
    const f = new FakeProvider();
    f.script([[{ type: 'text_delta', text: 'one' }, { type: 'stop', reason: 'end_turn' }], [{ type: 'text_delta', text: 'two' }, { type: 'stop', reason: 'end_turn' }]]);
    expect((await collect(run(f, userMsg('hours'))))[0]).toEqual({ type: 'text_delta', text: 'one' });
    expect((await collect(run(f, userMsg('hours'))))[0]).toEqual({ type: 'text_delta', text: 'two' });
    expect(toolOf(await collect(run(f, userMsg('hours')))).name).toBe('getHoursSummary');
  });
  it('stops yielding when aborted', async () => {
    const f = new FakeProvider();
    f.script([[{ type: 'text_delta', text: 'a' }, { type: 'text_delta', text: 'b' }, { type: 'stop', reason: 'end_turn' }]]);
    const ac = new AbortController();
    const seen: AiChunk[] = [];
    for await (const c of run(f, userMsg('x'), ac.signal)) {
      seen.push(c);
      ac.abort();
    }
    expect(seen).toHaveLength(1);
  });
});
