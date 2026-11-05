import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_KEY_SCOPES, newId } from '@tallywork/domain';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/**
 * Gate 1 (business correctness): the boundaries around every organization route, checked against
 * the API's own route table rather than a hand-kept list, so a route added later is covered without
 * anyone remembering to add it here.
 *
 * - A member of another organization never reaches it (404, as if it did not exist).
 * - A desktop device token never reaches it (403): devices use /agent/* only, so a client can never
 *   write time entries or anything else through the workspace API (the server owns time).
 * - An API key reaches exactly the endpoints docs/api/README.md lists for its scopes, nothing more.
 */
let t: Harness;
let adminA: Client;
let orgA: string;
let adminB: Client;
let device: Client;
let key: Client;

type Route = { method: string; path: string };
let routes: Route[];

/** A route template with each `:name{a|b}` alternative expanded, e.g. `/:kind{apps|urls}` → `/apps`, `/urls`. */
function expand(path: string): string[] {
  const m = /:\w+\{([^}]+)\}/.exec(path);
  if (!m) return [path];
  return m[1]!.split('|').flatMap((alt) => expand(path.replace(m[0], alt)));
}
/** A concrete URL for a template: real organization id, random ids for everything else. */
const concrete = (path: string) => `/orgs/${orgA}${path.replace(/:\w+/g, () => newId())}`;
const bodyFor = (method: string) => (method === 'GET' || method === 'DELETE' ? undefined : {});
const title = (b: unknown) => String((b as { title?: string } | null)?.title ?? '');

beforeAll(async () => {
  t = await createHarness();
  ({ client: adminA, orgId: orgA } = await signup(t, 'Ann Admin', 'ann@a.test', 'Org A'));
  ({ client: adminB } = await signup(t, 'Ben Admin', 'ben@b.test', 'Org B'));
  const { client: worker } = await addMember(t, adminA, orgA, 'Wim Worker', 'wim@a.test');

  const { verifier, challenge } = pkce();
  const code = await worker.post('/agent/authorize', { code_challenge: challenge, organization_id: orgA });
  device = new Client(t);
  device.bearer = (await device.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'Laptop', platform: 'windows', agent_version: '0.2.0' } })).body.access_token;
  expect(device.bearer).toBeTruthy();

  key = new Client(t);
  key.bearer = (await adminA.post(`/orgs/${orgA}/api-keys`, { name: 'Every scope', scopes: Object.keys(API_KEY_SCOPES) })).body.key;
  expect(key.bearer).toBeTruthy();

  const prefix = '/api/v1/orgs/:orgId';
  const seen = new Set<string>();
  routes = [];
  for (const r of (t.app as unknown as { routes: Route[] }).routes) {
    if (r.method === 'ALL' || !r.path.startsWith(prefix)) continue;
    for (const path of expand(r.path.slice(prefix.length))) {
      const k = `${r.method} ${path}`;
      if (!seen.has(k)) routes.push({ method: r.method, path }), seen.add(k);
    }
  }
});
afterAll(() => t.close());

describe('every organization route', () => {
  it('is found in the route table (the sweeps below are not empty)', () => {
    expect(routes.length).toBeGreaterThan(250);
    expect(routes).toContainEqual({ method: 'GET', path: '/payroll/runs' });
    expect(routes).toContainEqual({ method: 'GET', path: '/performance/members/:id/reviews' });
  });

  it('should_return_404_to_a_member_of_another_organization', async () => {
    const leaks: string[] = [];
    for (const r of routes) {
      const res = await adminB.req(r.method, concrete(r.path), bodyFor(r.method));
      if (res.status !== 404) leaks.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });

  it('should_refuse_desktop_device_tokens_so_clients_never_write_time_through_the_workspace_api', async () => {
    const leaks: string[] = [];
    for (const r of routes) {
      const res = await device.req(r.method, concrete(r.path), bodyFor(r.method));
      if (res.status !== 403 || !/Device tokens cannot access organization APIs/.test(title(res.body))) leaks.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(leaks).toEqual([]);
  });
});

/**
 * The endpoints docs/api/README.md ("Scopes and the endpoints they open") lists, as route templates.
 * `GET ''` is the organization itself, open to any key. Keep this in step with that table.
 */
const DOCUMENTED_FOR_API_KEYS = new Set([
  'GET ',
  'GET /workers', 'GET /workers/:id',
  'GET /teams', 'GET /teams/:id',
  'GET /clients', 'GET /clients/:id',
  'GET /projects', 'GET /projects/:id',
  'GET /tasks', 'GET /tasks/:id', 'GET /projects/:id/tasks',
  'GET /timesheets', 'GET /timesheets/:id/history',
  'GET /time-entries', 'GET /time-entries/:id/revisions', 'GET /sessions', 'GET /sessions/:id',
  'GET /activity/day', 'GET /screenshots', 'GET /apps', 'GET /urls', 'GET /apps/spans', 'GET /urls/spans', 'GET /idle-events',
  'GET /reports', 'POST /reports/:key/query',
  'GET /billing/amounts-owed', 'GET /rates', 'GET /budgets',
  'GET /invoices', 'GET /invoices/:id', 'GET /payments',
  'POST /projects', 'PATCH /projects/:id', 'POST /projects/:id/archive', 'POST /projects/:id/restore',
  'POST /projects/:id/tasks', 'PATCH /tasks/:id', 'DELETE /tasks/:id',
  'POST /clients', 'PATCH /clients/:id', 'POST /clients/:id/archive', 'POST /clients/:id/restore',
]);

describe('API keys', () => {
  it('should_open_only_the_documented_endpoints_even_with_every_scope', async () => {
    const open: string[] = [];
    for (const r of routes) {
      const res = await key.req(r.method, concrete(r.path), bodyFor(r.method));
      // Refused by the key's endpoint list (as opposed to a later permission or validation check).
      if (!(res.status === 403 && /does not have a scope for this endpoint/.test(title(res.body)))) open.push(`${r.method} ${r.path}`);
    }
    // Nothing undocumented is reachable: payroll, the Performance Center, portal settings, support
    // access, settings, members' private data and deletions all stay closed to keys.
    expect(open.filter((r) => !DOCUMENTED_FOR_API_KEYS.has(r))).toEqual([]);
    // And every documented endpoint that exists is open.
    const existing = new Set(routes.map((r) => `${r.method} ${r.path}`));
    expect([...DOCUMENTED_FOR_API_KEYS].filter((r) => existing.has(r) && !open.includes(r))).toEqual([]);
  });

  it.each(['/payroll/runs', '/performance/overview', '/performance/members', '/support-access', '/audit-logs', '/api-keys'])('should_refuse_api_keys_on_%s', async (path) => {
    const res = await key.get(`/orgs/${orgA}${path}`);
    expect(res.status).toBe(403);
  });
});
