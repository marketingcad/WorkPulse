import { Hono } from 'hono';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import { sectionFor } from '@tallywork/domain/assistant';
import { assistantCreateInput, assistantRenameInput, assistantSendInput, type AssistantErrorCode } from '@tallywork/contracts';
import type { AppEnv } from '../context';
import { body, query } from '../lib/http';
import { ctx } from '../services/ctx';
import { assertAssistantAccess } from '../services/assistant/access';
import { STREAM_TIMEOUT_MS, prepareTurn, releaseLock, runAssistantTurn, saveTurn } from '../services/assistant/orchestrator';
import { buildSystemPrompt, historyToMessages } from '../services/assistant/prompt';
import { createConversation, deleteConversation, getConversation, listConversations, renameConversation } from '../services/assistant/conversations';

/**
 * WorkPulse AI assistant (organization routes, mounted at /assistant). Web sessions only: the
 * `tenant` middleware keeps API keys off these paths, and the access check refuses desktop-only
 * roles. The `assistant:crud`, `assistant:msg` and `assistant:day` rate limits are applied in app.ts
 * before `tenant`, so their writes do not happen inside the tenant transaction (which would deadlock
 * single-connection PGlite).
 */
/** Conversations list: at most 50 per page. */
const listQuery = z.object({ page: z.coerce.number().int().min(1).max(100_000).default(1), page_size: z.coerce.number().int().min(1).max(50).default(50) });

export const assistantRoutes = new Hono<AppEnv>()
  .get('/conversations', async (c) => {
    const x = ctx(c);
    assertAssistantAccess(x);
    const q = query(c, listQuery);
    return c.json(await listConversations(x, { page: q.page, pageSize: q.page_size }));
  })
  .post('/conversations', async (c) => {
    const x = ctx(c);
    assertAssistantAccess(x);
    const b = await body(c, assistantCreateInput);
    return c.json(await createConversation(x, b.title), 201);
  })
  .get('/conversations/:id', async (c) => {
    const x = ctx(c);
    assertAssistantAccess(x);
    return c.json(await getConversation(x, c.req.param('id')));
  })
  .patch('/conversations/:id', async (c) => {
    const x = ctx(c);
    assertAssistantAccess(x);
    const b = await body(c, assistantRenameInput);
    return c.json(await renameConversation(x, c.req.param('id'), b.title));
  })
  .delete('/conversations/:id', async (c) => {
    const x = ctx(c);
    assertAssistantAccess(x);
    await deleteConversation(x, c.req.param('id'));
    return c.body(null, 204);
  })
  /**
   * Send a message and stream the reply (spec §2, §4). The user message is saved and the lock
   * taken in the request transaction, which commits once the Response is returned. The reply then
   * streams outside it: each tool call and the final save use their own short tenant transactions.
   */
  .post('/conversations/:id/messages', async (c) => {
    const x = ctx(c);
    assertAssistantAccess(x);
    const b = await body(c, assistantSendInput);
    const turn = await prepareTurn(x, c.req.param('id'), b.content);
    const system = buildSystemPrompt(x, b.route ? sectionFor(b.route) : null, turn.roleName);
    const history = historyToMessages(turn.history);
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const ac = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, STREAM_TIMEOUT_MS);
      const abort = () => ac.abort();
      stream.onAbort(abort);
      c.req.raw.signal?.addEventListener('abort', abort);
      let released = false;
      try {
        await stream.writeSSE({ event: 'message_saved', data: JSON.stringify({ user_message_id: turn.userMessageId }) });
        for await (const ev of runAssistantTurn(x, { system, history, signal: ac.signal })) {
          if (ev.event !== '_final') {
            await stream.writeSSE({ event: ev.event, data: JSON.stringify(ev.data) });
            continue;
          }
          const errorCode: AssistantErrorCode | null = timedOut ? 'timeout' : ev.errorCode;
          const id = await saveTurn(x, turn.conversationId, { ...ev, errorCode });
          released = true;
          if (errorCode) await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: errorCode, retryable: true }) });
          else await stream.writeSSE({ event: 'done', data: JSON.stringify({ assistant_message_id: id }) });
        }
      } catch (e) {
        console.error(JSON.stringify({ level: 'error', msg: 'assistant stream failed', request_id: x.requestId, code: (e as Error)?.name }));
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: 'internal', retryable: true }) });
      } finally {
        clearTimeout(timer);
        c.req.raw.signal?.removeEventListener('abort', abort);
        if (!released) {
          await releaseLock(x, turn.conversationId).catch((e) =>
            console.error(JSON.stringify({ level: 'error', msg: 'assistant lock release failed', request_id: x.requestId, code: (e as Error)?.name })),
          );
        }
      }
    });
  });
