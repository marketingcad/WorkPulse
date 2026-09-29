import { Hono } from 'hono';
import { clientPortalAcceptInput } from '@tallywork/contracts';
import type { AppEnv } from '../context';
import { body } from '../lib/http';
import { rateLimit } from '../middleware/rate-limit';
import { startUserSession } from './auth';
import { acceptPortalInvitation } from '../services/portal';

/** Client portal: read-only dashboards for an organization's clients (never members; see services/portal.ts). */
export const portalRoutes = new Hono<AppEnv>()
  .post('/invitations/accept', rateLimit('portal-accept', 20, 3600), async (c) => {
    const p = c.var.principal;
    const r = await acceptPortalInvitation(c.var.deps, await body(c, clientPortalAcceptInput), p?.type === 'user' ? p.userId : null);
    if (r.created) await startUserSession(c, r.userId);
    return c.json({ access_id: r.accessId });
  });
