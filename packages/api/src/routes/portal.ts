import { Hono, type Context } from 'hono';
import { clientPortalAcceptInput, portalRangeInput } from '@tallywork/contracts';
import { DomainError, isUuid, notFound } from '@tallywork/domain';
import type { AppEnv } from '../context';
import { body, query } from '../lib/http';
import { rateLimit } from '../middleware/rate-limit';
import { startUserSession } from './auth';
import { acceptPortalInvitation, listMyPortals, loadPortalAccess, portalScreenshots, portalSummary } from '../services/portal';

function viewer(c: Context<AppEnv>): string {
  const p = c.var.principal;
  // MFA-pending sessions are already limited to the two MFA paths by middleware/auth.ts.
  if (!p || p.type !== 'user') throw new DomainError('unauthenticated', 'unauthenticated', 'Please sign in to continue');
  return p.userId;
}

/** A malformed :accessId must read exactly like an unknown one — 404, not a 500 from an uncaught ZodError. */
function accessIdParam(c: Context<AppEnv>): string {
  const id = c.req.param('accessId');
  if (!id || !isUuid(id)) throw notFound('dashboard');
  return id;
}

/** Client portal: read-only dashboards for an organization's clients (never members; see services/portal.ts). */
export const portalRoutes = new Hono<AppEnv>()
  .post('/invitations/accept', rateLimit('portal-accept', 20, 3600), async (c) => {
    const p = c.var.principal;
    const r = await acceptPortalInvitation(c.var.deps, await body(c, clientPortalAcceptInput), p?.type === 'user' ? p.userId : null);
    if (r.created) await startUserSession(c, r.userId);
    return c.json({ access_id: r.accessId });
  })
  .use(rateLimit('portal', 120, 60))
  .get('/', async (c) => c.json(await listMyPortals(c.var.deps, viewer(c))))
  .get('/:accessId/summary', async (c) => {
    const access = await loadPortalAccess(c.var.deps, viewer(c), accessIdParam(c));
    return c.json(await portalSummary(c.var.deps, access, query(c, portalRangeInput)));
  })
  .get('/:accessId/screenshots', async (c) => {
    const access = await loadPortalAccess(c.var.deps, viewer(c), accessIdParam(c));
    return c.json(await portalScreenshots(c.var.deps, access, query(c, portalRangeInput)));
  });
