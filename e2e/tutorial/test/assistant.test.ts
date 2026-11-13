import { describe, expect, it } from 'vitest';
import { assistantStreamEvent, type AssistantConversationDto, type AssistantMessageDto, type AssistantStreamEvent } from '@tallywork/contracts/assistant';
import type { PortalAiSummaryDto } from '@tallywork/contracts';
// The app's own stream parser: what the assistant panel does with the bytes.
import { createSseParser } from '../../../apps/web/components/assistant/sse';
import { ScriptedAssistant, sseBody } from '../assistant';

const ORG = '00000000-0000-4000-8000-000000000001';
const U1 = '00000000-0000-4000-8000-0000000000a1';
const A1 = '00000000-0000-4000-8000-0000000000b1';
const base = `/api/v1/orgs/${ORG}/assistant`;
type Conversation = AssistantConversationDto & { messages: AssistantMessageDto[] };

function read(chunks: string[]): AssistantStreamEvent[] {
  const events: AssistantStreamEvent[] = [];
  const feed = createSseParser((e) => events.push(e));
  for (const c of chunks) feed(c);
  return events;
}
const json = (r: { body: string }) => JSON.parse(r.body) as unknown;
/** The scripted response, which these requests always get. */
function call(a: ScriptedAssistant, ...args: Parameters<ScriptedAssistant['handle']>) {
  const r = a.handle(...args);
  if (!r) throw new Error('not handled by the script');
  return r;
}

describe('sseBody', () => {
  it('streams the text as the panel reads it: saved, the words, done', () => {
    const text = 'Here are the **three** projects closest to their budget:\n\n- Globex — Website Redesign';
    const events = read(sseBody(text, { user: U1, assistant: A1 }));
    expect(events[0]).toEqual({ event: 'message_saved', data: { user_message_id: U1 } });
    expect(events.at(-1)).toEqual({ event: 'done', data: { assistant_message_id: A1 } });
    const deltas = events.filter((e) => e.event === 'delta');
    expect(deltas.length).toBeGreaterThan(3);
    expect(deltas.map((e) => (e.event === 'delta' ? e.data.text : '')).join('')).toBe(text);
    for (const e of events) expect(assistantStreamEvent.safeParse(e).success).toBe(true);
  });
});

describe('ScriptedAssistant', () => {
  const scripted = () => {
    const a = new ScriptedAssistant('16.1', ORG);
    a.answer('Which projects are close to their budget?', 'Two projects are close: **Globex — Website Redesign** and Wonka — SEO Retainer.', 'Projects close to budget');
    return a;
  };

  it('plays the whole turn: a new chat, the stream, then the saved chat and the list', () => {
    const a = scripted();
    const created = call(a, 'POST', `${base}/conversations`, '{}');
    expect(created.status).toBe(201);
    const chat = json(created) as AssistantConversationDto;

    const stream = call(a, 'POST', `${base}/conversations/${chat.id}/messages`, JSON.stringify({ content: 'Which projects are close to their budget?', route: '/o/x' }));
    expect(stream.contentType).toBe('text/event-stream');
    const text = read([stream.body])
      .filter((e) => e.event === 'delta')
      .map((e) => (e.event === 'delta' ? e.data.text : ''))
      .join('');
    expect(text).toContain('Globex');

    const saved = json(call(a, 'GET', `${base}/conversations/${chat.id}`, '')) as Conversation;
    expect(saved.title).toBe('Projects close to budget');
    expect(saved.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Which projects are close to their budget?'],
      ['assistant', 'Two projects are close: **Globex — Website Redesign** and Wonka — SEO Retainer.'],
    ]);

    const list = json(call(a, 'GET', `${base}/conversations?page=1&page_size=50`, '')) as { data: AssistantConversationDto[]; total: number };
    expect(list.data.map((c) => c.title)).toEqual(['Projects close to budget']);
    expect(list.total).toBe(1);
    expect(() => a.assertUsed()).not.toThrow();
  });

  it('accepts the question with different spacing and case', () => {
    const a = scripted();
    const chat = json(call(a, 'POST', `${base}/conversations`, '{}')) as AssistantConversationDto;
    expect(call(a, 'POST', `${base}/conversations/${chat.id}/messages`, JSON.stringify({ content: '  which projects are close to their  budget? ' })).status).toBe(200);
  });

  it('matches a question that carries dates by a pattern', () => {
    const a = new ScriptedAssistant('16.2', ORG);
    a.answer(/^Explain this insight and what I should do: "\d+ timesheets are waiting for approval"/, 'Approve them so pay and billing use approved time.');
    const chat = json(call(a, 'POST', `${base}/conversations`, '{}')) as AssistantConversationDto;
    const q = 'Explain this insight and what I should do: "12 timesheets are waiting for approval" (2026-11-09 to 2026-11-13).';
    expect(call(a, 'POST', `${base}/conversations/${chat.id}/messages`, JSON.stringify({ content: q })).status).toBe(200);
    expect(() => a.assertUsed()).not.toThrow();
  });

  it('fails the scene when the question is not the scripted one', () => {
    const a = scripted();
    const chat = json(call(a, 'POST', `${base}/conversations`, '{}')) as AssistantConversationDto;
    expect(call(a, 'POST', `${base}/conversations/${chat.id}/messages`, JSON.stringify({ content: 'Who is late today?' })).status).toBe(500);
    expect(() => a.assertUsed()).toThrow('Scene 16.1: asked "Who is late today?", but the script expects "Which projects are close to their budget?"');
  });

  it('fails the scene for a question with no scripted answer', () => {
    const a = new ScriptedAssistant('16.1', ORG);
    const chat = json(call(a, 'POST', `${base}/conversations`, '{}')) as AssistantConversationDto;
    call(a, 'POST', `${base}/conversations/${chat.id}/messages`, JSON.stringify({ content: 'Anything?' }));
    expect(() => a.assertUsed()).toThrow('Scene 16.1: asked "Anything?", but nothing more is scripted');
  });

  it('fails the scene when a scripted answer is never asked', () => {
    expect(() => scripted().assertUsed()).toThrow('Scene 16.1: the script expects "Which projects are close to their budget?", but it was never asked');
  });

  it('serves scripted drafts in order, and fails when none is left', () => {
    const a = new ScriptedAssistant('16.3', ORG);
    a.draft('Redesign of the Globex Retail website.', ['Client: Globex Retail']);
    expect(json(call(a, 'POST', `${base}/drafts`, JSON.stringify({ kind: 'project_description', project_id: ORG })))).toEqual({ text: 'Redesign of the Globex Retail website.', facts_used: ['Client: Globex Retail'] });
    expect(call(a, 'POST', `${base}/drafts`, '{}').status).toBe(500);
    expect(() => a.assertUsed()).toThrow('Scene 16.3: a "Write with AI" draft was asked for, but nothing more is scripted');
  });

  it('serves the client portal summary', () => {
    const a = new ScriptedAssistant('06.3', ORG);
    const dto: PortalAiSummaryDto = { text: 'This week the team worked on the Globex website.', source: 'ai', day: '2026-11-13', facts: ['Project: Globex — Website Redesign'] };
    a.portalSummary(dto);
    expect(json(call(a, 'GET', '/api/v1/portal/abc/ai-summary', ''))).toEqual(dto);
  });

  it('lets other requests through to the server', () => {
    const a = scripted();
    expect(a.handle('GET', `${base}/suggestions?route=%2F`, '')).toBeNull();
    expect(a.handle('GET', `/api/v1/orgs/${ORG}/projects`, '')).toBeNull();
  });

  it('renames and deletes a scripted chat', () => {
    const a = scripted();
    const chat = json(call(a, 'POST', `${base}/conversations`, '{}')) as AssistantConversationDto;
    expect((json(call(a, 'PATCH', `${base}/conversations/${chat.id}`, JSON.stringify({ title: 'Budgets' }))) as AssistantConversationDto).title).toBe('Budgets');
    expect(call(a, 'DELETE', `${base}/conversations/${chat.id}`, '').status).toBe(204);
    expect((json(call(a, 'GET', `${base}/conversations?page=1&page_size=50`, '')) as { data: unknown[] }).data).toEqual([]);
  });
});
