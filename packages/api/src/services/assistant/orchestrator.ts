import { and, desc, eq, gt } from 'drizzle-orm';
import { assistantConversations, assistantMessages, memberships, roles, withTenant, type AssistantToolCallRow, type Tx } from '@tallywork/db';
import { DomainError, newId } from '@tallywork/domain';
import type { AssistantErrorCode, AssistantStreamEvent } from '@tallywork/contracts';
import { AiError, type AiBlock, type AiMessage } from '../../lib/ai/provider';
import type { Ctx } from '../ctx';
import { ownedConversation } from './conversations';
import { HISTORY_LIMIT } from './prompt';
import { executeTool, toolSpecs, toolsFor } from './tools';

/** Tool rounds before a final answer is forced with no tools (spec §4). */
export const MAX_TOOL_ROUNDS = 6;
export const MAX_TOKENS = 1500;
export const MAX_REPLY_CHARS = 16_000;
/**
 * The stream stops this long before its lock expires, so the final save (which clears the lock)
 * happens while the lock is still its own. The window itself is `config.assistantStreamMs`.
 */
export function streamBudgetMs(lockUntil: Date, now: Date): number {
  const left = lockUntil.getTime() - now.getTime();
  return Math.max(1, left - Math.min(5_000, Math.floor(left / 10)));
}

const DEFAULT_TITLE = 'New chat';

export type TurnFinal = { event: '_final'; text: string; toolCalls: AssistantToolCallRow[]; nav: string[]; errorCode: AssistantErrorCode | null };

const FORCE_FINAL_NOTE = 'The tool limit for this answer is reached. Answer now with what you have, without calling tools.';

/**
 * One assistant reply: calls the model, runs the tools it asks for (each in its own short tenant
 * transaction, so this must run outside the request transaction) and streams events. Ends with a
 * `_final` record for the caller to save. Never throws.
 */
export async function* runAssistantTurn(x: Ctx, i: { system: string; history: AiMessage[]; signal: AbortSignal }): AsyncGenerator<AssistantStreamEvent | TurnFinal> {
  const tools = toolsFor(x.actor);
  const specs = toolSpecs(tools);
  const messages: AiMessage[] = [...i.history];
  const toolCalls: AssistantToolCallRow[] = [];
  const nav: string[] = [];
  let text = '';
  let errorCode: AssistantErrorCode | null = null;
  let rounds = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    const ai = x.deps.ai;
    if (!ai) throw new AiError('ai_unavailable');
    for (;;) {
      const forceFinal = rounds >= MAX_TOOL_ROUNDS;
      // The assistant turn as the provider sent it, thinking blocks included and in order: it is
      // replayed unchanged on the continuation call, and never stored.
      const blocks: AiBlock[] = [];
      // The forced final call keeps the tool definitions (the history holds tool blocks, which the
      // provider refuses without them) and forbids new calls with tool choice 'none'.
      const choice = forceFinal && specs.length ? { toolChoice: 'none' as const } : {};
      for await (const ch of ai.streamTurn({ system: i.system, messages, tools: specs, ...choice, maxTokens: MAX_TOKENS, signal: i.signal })) {
        if (ch.type === 'text_delta') {
          if (!ch.text) continue;
          const last = blocks[blocks.length - 1];
          if (last?.type === 'text') last.text += ch.text;
          else blocks.push({ type: 'text', text: ch.text });
          const room = MAX_REPLY_CHARS - text.length;
          if (room > 0) {
            const piece = ch.text.slice(0, room);
            text += piece;
            yield { event: 'delta', data: { text: piece } };
          }
        } else if (ch.type === 'tool_use') blocks.push({ type: 'tool_use', id: ch.id, name: ch.name, input: ch.input });
        else if (ch.type === 'thinking') blocks.push({ type: 'thinking', thinking: ch.thinking, signature: ch.signature });
        else if (ch.type === 'redacted_thinking') blocks.push({ type: 'redacted_thinking', data: ch.data });
        else if (ch.type === 'usage') {
          inputTokens += ch.inputTokens;
          outputTokens += ch.outputTokens;
        }
      }
      if (i.signal.aborted) break;
      const uses = blocks.filter((b): b is Extract<AiBlock, { type: 'tool_use' }> => b.type === 'tool_use');
      if (forceFinal || !uses.length) break;

      rounds++;
      messages.push({ role: 'assistant', content: blocks });
      const results: AiBlock[] = [];
      for (const use of uses) {
        // Only a tool's own name is ever echoed or stored, never model-supplied text.
        const name = tools.find((t) => t.name === use.name)?.name ?? 'unknown';
        yield { event: 'tool_status', data: { tool: name, state: 'running' } };
        const out = await executeTool(x, tools, use.name, use.input);
        toolCalls.push({ name, args: out.status === 'ok' ? out.args : null, status: out.status });
        yield { event: 'tool_status', data: { tool: name, state: out.status === 'ok' ? 'done' : out.status } };
        for (const link of out.nav) {
          if (nav.includes(link.key)) continue;
          nav.push(link.key);
          yield { event: 'nav', data: link };
        }
        results.push({ type: 'tool_result', tool_use_id: use.id, content: out.content, ...(out.status === 'ok' ? {} : { is_error: true }) });
        if (i.signal.aborted) break;
      }
      if (i.signal.aborted) break;
      if (rounds >= MAX_TOOL_ROUNDS) results.push({ type: 'text', text: FORCE_FINAL_NOTE });
      messages.push({ role: 'user', content: results });
    }
  } catch (e) {
    if (i.signal.aborted) errorCode = 'interrupted';
    else if (e instanceof AiError) errorCode = e.code;
    else {
      errorCode = 'internal';
      console.error(JSON.stringify({ level: 'error', msg: 'assistant turn failed', request_id: x.requestId, code: e instanceof DomainError ? e.code : (e as Error)?.name }));
    }
  }
  if (i.signal.aborted) errorCode = 'interrupted';
  // A finished turn with nothing to show is a bad response, not an empty reply to store.
  if (!errorCode && !text.trim()) errorCode = 'ai_bad_response';

  // Never the message text or tool output: ids, tool names, token counts and the error code only.
  const log = { level: errorCode && errorCode !== 'interrupted' ? 'warn' : 'info', msg: 'assistant turn', request_id: x.requestId, tools: toolCalls.map((c) => c.name), rounds, input_tokens: inputTokens, output_tokens: outputTokens, error_code: errorCode };
  if (log.level === 'warn') console.error(JSON.stringify(log));
  else if (x.deps.config.env !== 'test') console.log(JSON.stringify(log));

  yield { event: '_final', text, toolCalls, nav, errorCode };
}

export interface PreparedTurn {
  conversationId: string;
  userMessageId: string;
  /** The exact lock value this stream owns; it clears only this value. */
  lockUntil: Date;
  roleName: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * Runs in the request transaction: checks ownership and the one-stream-per-member lock, takes
 * the lock, and saves the user message (or reuses it when this is a retry of an unanswered one).
 */
export async function prepareTurn(x: Ctx, conversationId: string, content: string): Promise<PreparedTurn> {
  const tx = x.tx;
  const conv = await ownedConversation(tx, x, conversationId);
  const now = x.deps.now();

  // Serialize this member's sends on their membership row, so two requests can't both take the lock.
  // (PGlite has one connection, so the tests cannot prove this serialization; it relies on Postgres row locks.)
  const [member] = await tx
    .select({ roleName: roles.name })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.id, x.actor.membershipId), eq(memberships.organizationId, x.org.id)))
    .for('update', { of: memberships })
    .limit(1);
  const [busy] = await tx
    .select({ id: assistantConversations.id })
    .from(assistantConversations)
    .where(and(eq(assistantConversations.organizationId, x.org.id), eq(assistantConversations.membershipId, x.actor.membershipId), gt(assistantConversations.streamLockUntil, now)))
    .limit(1);
  if (busy) throw new DomainError('conflict', 'stream_in_progress', 'A reply is still being written. Wait for it to finish, then try again.');

  const recent = await tx
    .select({ id: assistantMessages.id, role: assistantMessages.role, content: assistantMessages.content })
    .from(assistantMessages)
    .where(and(eq(assistantMessages.organizationId, x.org.id), eq(assistantMessages.conversationId, conv.id)))
    .orderBy(desc(assistantMessages.createdAt), desc(assistantMessages.id))
    .limit(HISTORY_LIMIT);
  const history = recent.reverse();

  const latest = history[history.length - 1];
  let userMessageId: string;
  if (latest && latest.role === 'user' && latest.content === content) {
    userMessageId = latest.id;
  } else {
    userMessageId = newId();
    await tx.insert(assistantMessages).values({ id: userMessageId, organizationId: x.org.id, conversationId: conv.id, role: 'user', content });
    history.push({ id: userMessageId, role: 'user', content });
  }

  const title = conv.title === DEFAULT_TITLE ? content.replace(/\s+/g, ' ').trim().slice(0, 120) || DEFAULT_TITLE : conv.title;
  const lockUntil = new Date(now.getTime() + x.deps.config.assistantStreamMs);
  await tx
    .update(assistantConversations)
    .set({ streamLockUntil: lockUntil, title, lastMessageAt: now, updatedAt: now })
    .where(and(eq(assistantConversations.id, conv.id), eq(assistantConversations.organizationId, x.org.id)));

  return { conversationId: conv.id, userMessageId, lockUntil, roleName: member?.roleName ?? x.actor.roleKey, history: history.map((m) => ({ role: m.role, content: m.content })) };
}

const ownConversation = (x: Ctx, conversationId: string) =>
  and(eq(assistantConversations.id, conversationId), eq(assistantConversations.organizationId, x.org.id), eq(assistantConversations.membershipId, x.actor.membershipId));

/**
 * Compare-and-clear: only the stream that set this exact lock value releases it, so a stream whose
 * lock went stale and was taken over never clears the newer stream's lock.
 */
async function clearOwnLock(tx: Tx, x: Ctx, conversationId: string, lockUntil: Date): Promise<void> {
  await tx
    .update(assistantConversations)
    .set({ streamLockUntil: null })
    .where(and(ownConversation(x, conversationId), eq(assistantConversations.streamLockUntil, lockUntil)));
}

/**
 * Saves the reply and releases this stream's lock in one short tenant transaction. A failure with
 * no text saves nothing (the user message stays for a retry). Returns the reply id, if saved.
 */
async function saveTurn(x: Ctx, conversationId: string, lockUntil: Date, final: Pick<TurnFinal, 'text' | 'toolCalls' | 'nav' | 'errorCode'>): Promise<string | null> {
  return withTenant(x.deps.db, x.org.id, async (tx) => {
    const now = x.deps.now();
    const save = final.errorCode === null || final.text.trim().length > 0;
    const id = save ? newId() : null;
    if (id) {
      await tx.insert(assistantMessages).values({
        id,
        organizationId: x.org.id,
        conversationId,
        role: 'assistant',
        content: final.text.slice(0, MAX_REPLY_CHARS),
        toolCalls: final.toolCalls,
        navTargets: final.nav,
        errorCode: final.errorCode,
      });
    }
    await tx
      .update(assistantConversations)
      .set({ updatedAt: now, ...(id ? { lastMessageAt: now } : {}) })
      .where(ownConversation(x, conversationId));
    await clearOwnLock(tx, x, conversationId, lockUntil);
    return id;
  });
}

/** Releases this stream's lock on its own: used when saving the reply failed. */
async function releaseLock(x: Ctx, conversationId: string, lockUntil: Date): Promise<void> {
  await withTenant(x.deps.db, x.org.id, (tx) => clearOwnLock(tx, x, conversationId, lockUntil));
}

/** The route calls these through this object, so a test can make a save fail once. */
export const turnStore = { saveTurn, releaseLock };
