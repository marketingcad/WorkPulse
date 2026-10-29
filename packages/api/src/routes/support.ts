import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { parse, query } from '../lib/http';
import { rateLimit } from '../middleware/rate-limit';
import { assertSupportStaff, grantedDetails, organizationOverview, searchOrganizations } from '../services/support';

/** Tallywork staff support console (not tenant-scoped; see services/support.ts). */
export const supportRoutes = new Hono<AppEnv>()
  .use(rateLimit('support', 120, 60))
  .get('/me', async (c) => c.json(await assertSupportStaff(c.var.deps, c.var.principal)))
  .get('/orgs', async (c) => {
    const staff = await assertSupportStaff(c.var.deps, c.var.principal);
    return c.json(await searchOrganizations(c.var.deps, staff, query(c, z.object({ q: z.string().max(100) })).q));
  })
  .get('/orgs/:id', async (c) => {
    const staff = await assertSupportStaff(c.var.deps, c.var.principal);
    return c.json(await organizationOverview(c.var.deps, staff, parse(z.uuid(), c.req.param('id'))));
  })
  .get('/orgs/:id/details', async (c) => {
    const staff = await assertSupportStaff(c.var.deps, c.var.principal);
    return c.json(await grantedDetails(c.var.deps, staff, parse(z.uuid(), c.req.param('id'))));
  });
