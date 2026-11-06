import { Hono } from 'hono';
import { assistantCreateInput, assistantRenameInput, pageQuery } from '@tallywork/contracts';
import type { AppEnv } from '../context';
import { body, query } from '../lib/http';
import { ctx } from '../services/ctx';
import { assertAssistantAccess } from '../services/assistant/access';
import { createConversation, deleteConversation, getConversation, listConversations, renameConversation } from '../services/assistant/conversations';

/**
 * WorkPulse AI assistant (organization routes, mounted at /assistant). Web sessions only: the
 * `tenant` middleware keeps API keys off these paths, and the access check refuses desktop-only
 * roles. The `assistant:crud` rate limit is applied in app.ts before `tenant`, so its write does
 * not happen inside the tenant transaction (which would deadlock single-connection PGlite).
 */
export const assistantRoutes = new Hono<AppEnv>()
  .get('/conversations', async (c) => {
    const x = ctx(c);
    assertAssistantAccess(x);
    const q = query(c, pageQuery);
    return c.json(await listConversations(x, { page: q.page ?? 1, pageSize: q.page_size }));
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
  });
