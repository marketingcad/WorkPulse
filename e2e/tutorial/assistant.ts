/**
 * Scripted WorkPulse AI for the recordings: every AI text shown on camera is written in the chapter
 * script, so it is the same in every recording and no model is called.
 *
 * The tutorial server runs the assistant's built-in test mode (serve-tutorial.mjs), so the assistant
 * button, "Write with AI" and the portal's AI summary switch appear as they do in production. In the
 * browser, this answers the assistant's requests in place of the server, in the API's own formats:
 *
 * - the panel's round trip: a new chat (POST …/conversations), the reply stream (POST
 *   …/conversations/:id/messages, server-sent events), the saved chat (GET …/conversations/:id) and
 *   the list of past chats (GET …/conversations). The panel shows only what the saved chat returns
 *   once a reply ends, so all four are answered from the same scripted chats;
 * - "Write with AI" drafts (POST …/assistant/drafts);
 * - the client portal's AI summary (GET /portal/:accessId/ai-summary).
 *
 * Every other request goes to the server. A question that is not the scripted one, or one with
 * nothing scripted, fails the scene at d.finish() (and the panel shows an error meanwhile).
 */
import { randomUUID } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import type { AssistantConversationDto, AssistantDraftDto, AssistantMessageDto } from '@tallywork/contracts/assistant';
import type { PortalAiSummaryDto } from '@tallywork/contracts';

/** Words per streamed piece, and the pause between pieces: about the pace of the real assistant. */
const WORDS_PER_DELTA = 3;
export const DELTA_PAUSE_MS = 45;

/** The reply as server-sent events, in pieces: saved, the text a few words at a time, done. */
export function sseBody(text: string, ids: { user: string; assistant: string }): string[] {
  const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  // Split after spaces and line breaks, keeping them, so the pieces join back to the exact text.
  const words = text.match(/\S+\s*|\s+/g) ?? [];
  const deltas: string[] = [];
  for (let i = 0; i < words.length; i += WORDS_PER_DELTA) deltas.push(event('delta', { text: words.slice(i, i + WORDS_PER_DELTA).join('') }));
  return [event('message_saved', { user_message_id: ids.user }), ...deltas, event('done', { assistant_message_id: ids.assistant })];
}

interface Chat extends AssistantConversationDto {
  messages: AssistantMessageDto[];
}

export interface Handled {
  status: number;
  contentType: string;
  body: string;
  /** For a stream: the pieces, sent with a pause between them where the browser allows it. */
  chunks?: string[];
}

const same = (asked: string, expected: string | RegExp) =>
  typeof expected === 'string' ? asked.trim().replace(/\s+/g, ' ').toLowerCase() === expected.trim().replace(/\s+/g, ' ').toLowerCase() : expected.test(asked.trim());

export class ScriptedAssistant {
  private readonly answers: Array<{ question: string | RegExp; markdown: string; title?: string }> = [];
  private readonly drafts: AssistantDraftDto[] = [];
  private summary: PortalAiSummaryDto | null = null;
  private readonly chats: Chat[] = [];
  private readonly failures: string[] = [];

  constructor(
    private readonly sceneId: string,
    private readonly orgId: string,
  ) {}

  /**
   * The next question asked in the panel, and its answer (Markdown, as the assistant writes it). A
   * pattern matches a question that carries dates, such as "Explain with WorkPulse AI" on a finding.
   */
  answer(question: string | RegExp, markdown: string, title?: string): void {
    this.answers.push({ question, markdown, ...(title ? { title } : {}) });
  }

  /** The next "Write with AI" draft. */
  draft(text: string, facts: string[] = []): void {
    this.drafts.push({ text, facts_used: facts });
  }

  /** The client portal's AI summary, for as long as the scene runs. */
  portalSummary(dto: PortalAiSummaryDto): void {
    this.summary = dto;
  }

  /** Throws when the scene asked for something not scripted, or did not ask for what was. */
  assertUsed(): void {
    const unused = this.answers.map((a) => `Scene ${this.sceneId}: the script expects "${a.question}", but it was never asked`);
    const unusedDrafts = this.drafts.map((d) => `Scene ${this.sceneId}: a scripted draft ("${d.text.slice(0, 40)}…") was never asked for`);
    const all = [...this.failures, ...unused, ...unusedDrafts];
    if (all.length) throw new Error(all.join('\n'));
  }

  /** The scripted response to a request, or null to let it through to the server. */
  handle(method: string, url: string, body: string): Handled | null {
    const path = new URL(url, 'http://x').pathname;
    if (method === 'GET' && /^\/api\/v1\/portal\/[^/]+\/ai-summary$/.test(path)) return this.summary ? ok(this.summary) : null;

    const base = `/api/v1/orgs/${this.orgId}/assistant`;
    if (!path.startsWith(base)) return null;
    const rest = path.slice(base.length);

    if (method === 'POST' && rest === '/drafts') {
      const next = this.drafts.shift();
      if (!next) return this.fail(`a "Write with AI" draft was asked for, but nothing more is scripted`);
      return ok(next);
    }
    if (rest === '/conversations') {
      if (method === 'GET') {
        const data = [...this.chats].sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at)).map(summary);
        return ok({ data, total: data.length, page: 1, page_size: 50 });
      }
      if (method === 'POST') {
        const now = new Date().toISOString();
        const title = (JSON.parse(body || '{}') as { title?: string }).title;
        const chat: Chat = { id: randomUUID(), title: title ?? 'New chat', created_at: now, last_message_at: null, messages: [] };
        this.chats.push(chat);
        return ok(summary(chat), 201);
      }
    }
    const m = /^\/conversations\/([^/]+)(\/messages)?$/.exec(rest);
    const chat = m ? this.chats.find((c) => c.id === m[1]) : undefined;
    if (!m || !chat) return null;
    if (m[2] && method === 'POST') return this.turn(chat, (JSON.parse(body || '{}') as { content?: string }).content ?? '');
    if (method === 'GET') return ok(chat);
    if (method === 'PATCH') {
      chat.title = (JSON.parse(body || '{}') as { title?: string }).title ?? chat.title;
      return ok(summary(chat));
    }
    if (method === 'DELETE') {
      this.chats.splice(this.chats.indexOf(chat), 1);
      return { status: 204, contentType: 'text/plain', body: '' };
    }
    return null;
  }

  /** Routes the scripted requests on `page`; everything else continues to the server. */
  async install(page: Page): Promise<void> {
    await page.route(
      (url) => url.pathname.startsWith(`/api/v1/orgs/${this.orgId}/assistant/`) || /^\/api\/v1\/portal\/[^/]+\/ai-summary$/.test(url.pathname),
      async (route: Route) => {
        const req = route.request();
        const r = this.handle(req.method(), req.url(), req.postData() ?? '');
        if (!r) return route.continue();
        // A fulfilled response arrives in one piece; the pause before it stands in for the model thinking.
        if (r.chunks) await new Promise((res) => setTimeout(res, DELTA_PAUSE_MS * 8));
        return route.fulfill({ status: r.status, contentType: r.contentType, body: r.body });
      },
    );
  }

  private turn(chat: Chat, content: string): Handled {
    const next = this.answers[0];
    if (!next) return this.fail(`asked "${content.trim()}", but nothing more is scripted`);
    if (!same(content, next.question)) return this.fail(`asked "${content.trim()}", but the script expects "${next.question}"`);
    this.answers.shift();
    const now = new Date().toISOString();
    const user: AssistantMessageDto = { id: randomUUID(), role: 'user', content: content.trim(), tool_calls: [], nav: [], error_code: null, created_at: now };
    const reply: AssistantMessageDto = { id: randomUUID(), role: 'assistant', content: next.markdown, tool_calls: [], nav: [], error_code: null, created_at: now };
    chat.messages.push(user, reply);
    chat.last_message_at = now;
    if (chat.title === 'New chat') chat.title = next.title ?? content.trim().slice(0, 60);
    const chunks = sseBody(next.markdown, { user: user.id, assistant: reply.id });
    return { status: 200, contentType: 'text/event-stream', body: chunks.join(''), chunks };
  }

  private fail(why: string): Handled {
    this.failures.push(`Scene ${this.sceneId}: ${why}`);
    return { status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Not in the tutorial script', status: 500 }) };
  }
}

const ok = (data: unknown, status = 200): Handled => ({ status, contentType: 'application/json', body: JSON.stringify(data) });
const summary = (c: Chat): AssistantConversationDto => ({ id: c.id, title: c.title, created_at: c.created_at, last_message_at: c.last_message_at });
