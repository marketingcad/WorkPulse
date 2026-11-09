import Anthropic from '@anthropic-ai/sdk';
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
  it('uses the fake in production only when the E2E server sets both flags', () => {
    expect(createAiProvider({ NODE_ENV: 'production', ASSISTANT_FAKE: '1', TALLYWORK_E2E: '1' })).toBeInstanceOf(FakeProvider);
    expect(createAiProvider({ NODE_ENV: 'production', ASSISTANT_FAKE: '1' }).available).toBe(false);
    expect(createAiProvider({ NODE_ENV: 'production', TALLYWORK_E2E: '1' }).available).toBe(false);
    // A real key always wins over the test flags.
    expect(createAiProvider({ NODE_ENV: 'production', ANTHROPIC_API_KEY: 'sk-ant-x', ASSISTANT_FAKE: '1', TALLYWORK_E2E: '1' })).toBeInstanceOf(AnthropicProvider);
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
  it('maps an in-stream SDK error thrown for an SSE error event', async () => {
    // Built the way core/streaming.js builds it: status undefined, type from the event.
    const thrower = (err: unknown) => async () =>
      (async function* () {
        yield { type: 'message_start', message: { usage: {} } };
        throw err;
      })();
    const sse = (type: string) => new Anthropic.APIError(undefined, { type: 'error', error: { type, message: 'secret sk-ant-x' } }, undefined, undefined, type as never);
    for (const [type, code] of [['overloaded_error', 'ai_rate_limited'], ['rate_limit_error', 'ai_rate_limited'], ['api_error', 'ai_unavailable']] as const) {
      const p = new AnthropicProvider('k', 'm', fakeClient(thrower(sse(type))));
      const e = await collect(run(p, userMsg('hi'))).catch((x) => x);
      expect(e.code).toBe(code);
      expect(e.message).not.toContain('secret');
    }
    const bad = new AnthropicProvider('k', 'm', fakeClient(thrower(new SyntaxError('Unexpected token'))));
    await expect(collect(run(bad, userMsg('hi')))).rejects.toMatchObject({ code: 'ai_bad_response' });
  });
  it('maps connection errors and timeouts to ai_unavailable', async () => {
    for (const err of [new Anthropic.APIConnectionError({ message: 'down' }), new Anthropic.APIConnectionTimeoutError()]) {
      const p = new AnthropicProvider('k', 'm', fakeClient(() => Promise.reject(err)));
      await expect(collect(run(p, userMsg('hi')))).rejects.toMatchObject({ code: 'ai_unavailable' });
    }
  });
  it('ends quietly when aborted mid-stream, even without a stop event', async () => {
    const ac = new AbortController();
    const p = new AnthropicProvider(
      'k',
      'm',
      fakeClient(async () =>
        (async function* () {
          yield { type: 'message_start', message: { usage: {} } };
          ac.abort();
        })(),
      ),
    );
    expect(await collect(run(p, userMsg('hi'), ac.signal))).toEqual([]);
  });
  it('sends the model, max_tokens, mapped tools and the signal; thinking is omitted', async () => {
    let seen: { params: any; options: any } | undefined;
    const p = new AnthropicProvider('k', 'claude-sonnet-5-5', {
      messages: {
        create: async (params: any, options: any) => {
          seen = { params, options };
          return (async function* () {
            yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } };
          })();
        },
      },
    });
    const ac = new AbortController();
    await collect(p.streamTurn({ system: 'sys', messages: userMsg('hi'), tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }], maxTokens: 321, signal: ac.signal }));
    expect(seen!.params).toMatchObject({
      model: 'claude-sonnet-5-5',
      max_tokens: 321,
      system: 'sys',
      stream: true,
      tools: [{ name: 't', description: 'd', input_schema: { type: 'object' } }],
    });
    expect(seen!.params).not.toHaveProperty('thinking');
    expect(seen!.params).not.toHaveProperty('tool_choice');
    expect(seen!.options.signal).toBe(ac.signal);
  });
  it("maps toolChoice 'none' to tool_choice none and keeps the tools; 'auto' sends nothing extra", async () => {
    const seen: any[] = [];
    const p = new AnthropicProvider('k', 'm', {
      messages: {
        create: async (params: any) => {
          seen.push(params);
          return (async function* () {
            yield { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } };
          })();
        },
      },
    });
    const tools = [{ name: 't', description: 'd', inputSchema: { type: 'object' } }];
    const signal = new AbortController().signal;
    await collect(p.streamTurn({ system: 's', messages: userMsg('hi'), tools, toolChoice: 'none', maxTokens: 10, signal }));
    await collect(p.streamTurn({ system: 's', messages: userMsg('hi'), tools, toolChoice: 'auto', maxTokens: 10, signal }));
    expect(seen[0].tool_choice).toEqual({ type: 'none' });
    expect(seen[0].tools).toHaveLength(1);
    expect(seen[1]).not.toHaveProperty('tool_choice');
  });
  it('FakeProvider records toolChoice in calls', async () => {
    const f = new FakeProvider();
    f.script([[{ type: 'stop', reason: 'end_turn' }]]);
    await collect(f.streamTurn({ system: 's', messages: userMsg('hi'), tools: [], toolChoice: 'none', maxTokens: 10, signal: new AbortController().signal }));
    expect(f.calls[0]!.toolChoice).toBe('none');
  });
  it('round-trips thinking blocks unchanged', async () => {
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'think.' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'opaque' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    ];
    const sent: any[] = [];
    const p = new AnthropicProvider('k', 'm', {
      messages: {
        create: async (params: any) => {
          sent.push(params.messages);
          return (async function* () {
            for (const e of events) yield e;
          })();
        },
      },
    });
    const out = await collect(run(p, userMsg('hi')));
    const blocks = out.filter((c) => c.type === 'thinking' || c.type === 'redacted_thinking');
    expect(blocks).toEqual([
      { type: 'thinking', thinking: 'Let me think.', signature: 'sig123' },
      { type: 'redacted_thinking', data: 'opaque' },
    ]);
    const history: AiMessage[] = [...userMsg('hi'), { role: 'assistant', content: blocks as AiMessage['content'] }];
    await collect(run(p, history));
    expect(sent[1][1].content).toEqual(blocks);
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
    const fixed = new FakeProvider(() => new Date('2026-11-11T10:00:00Z')); // a Wednesday
    expect(toolOf(await collect(run(fixed, userMsg('hours')))).input).toEqual({ from: '2026-11-09', to: '2026-11-11', group: 'member' });
    expect(toolOf(await collect(run(f, userMsg('project budget?')))).name).toBe('getProjectBudgetSummary');
    const nav = toolOf(await collect(run(f, userMsg('where do I approve timesheets'))));
    expect(nav).toMatchObject({ name: 'suggestNavigation', input: { key: 'timesheets.approvals' } });
    const doc = toolOf(await collect(run(f, userMsg('x'.repeat(300)))));
    expect(doc.name).toBe('searchWorkPulseDocumentation');
    expect((doc.input as { query: string }).query).toHaveLength(200);
    await expect(collect(run(f, userMsg('error-test')))).rejects.toMatchObject({ code: 'ai_unavailable' });
    expect(f.calls.length).toBe(5);
  });
  it('records calls as copies', async () => {
    const f = new FakeProvider();
    const msgs = userMsg('hi');
    await collect(run(f, msgs));
    msgs[0]!.content.push({ type: 'text', text: 'later' });
    expect(f.calls[0]!.messages[0]!.content).toHaveLength(1);
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
