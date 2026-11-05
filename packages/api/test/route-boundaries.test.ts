import { readFileSync } from 'node:fs';
import path from 'node:path';
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
let workerId: string;

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
  const { client: worker, membershipId } = await addMember(t, adminA, orgA, 'Wim Worker', 'wim@a.test');
  workerId = membershipId;

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
 * The endpoints docs/api/README.md ("Scopes and the endpoints they open") lists, read from that table,
 * so the docs and the code cannot drift apart: change one without the other and this fails.
 * `GET /orgs/{orgId}` is the organization itself (route `GET `).
 */
function documentedForApiKeys(): Set<string> {
  const md = readFileSync(path.resolve(__dirname, '../../../docs/api/README.md'), 'utf8');
  const table = md.slice(md.indexOf('| Scope | Endpoints |')).split(/\r?\n\r?\n/)[0]!;
  const out = new Set<string>();
  for (const m of table.matchAll(/`(GET|POST|PATCH|PUT|DELETE) (\/[^`?]*)(\?[^`]*)?`/g)) {
    const p = m[2] === '/orgs/{orgId}' ? '' : m[2]!.replace(/\{(\w+)\}/g, ':$1');
    out.add(`${m[1]} ${p}`);
  }
  return out;
}

describe('API keys', () => {
  it('should_open_only_the_documented_endpoints_even_with_every_scope', async () => {
    const DOCUMENTED_FOR_API_KEYS = documentedForApiKeys();
    expect(DOCUMENTED_FOR_API_KEYS.size).toBeGreaterThan(20); // the table was found
    const open: string[] = [];
    for (const r of routes) {
      const res = await key.req(r.method, concrete(r.path), bodyFor(r.method));
      // Refused by the key's endpoint list (as opposed to a later permission or validation check).
      if (!(res.status === 403 && /does not have a scope for this endpoint/.test(title(res.body)))) open.push(`${r.method} ${r.path}`);
    }
    // Nothing undocumented is reachable: payroll, the Performance Center, portal settings, support
    // access, settings, members' private data and deletions all stay closed to keys.
    expect(open.filter((r) => !DOCUMENTED_FOR_API_KEYS.has(r))).toEqual([]);
    // Every documented endpoint exists (the docs promise nothing that is not there) and is open.
    const existing = new Set(routes.map((r) => `${r.method} ${r.path}`));
    expect([...DOCUMENTED_FOR_API_KEYS].filter((r) => !existing.has(r))).toEqual([]);
    expect([...DOCUMENTED_FOR_API_KEYS].filter((r) => !open.includes(r))).toEqual([]);
  });

  // Security decision (6 Nov 2026, D-2): monitoring data, and money other than amounts owed and
  // invoices, stay with people who sign in. Some were once listed in the docs under read:time,
  // read:activity, read:billing and read:invoices; the endpoint list closes them whatever the scope.
  it.each([
    '/sessions', '/screenshots', '/apps', '/urls', '/apps/spans', '/urls/spans', '/rates', '/budgets', '/payments',
    '/payroll/runs', '/performance/overview', '/performance/members', '/support-access', '/audit-logs', '/api-keys', '/workers/options',
  ])('should_refuse_an_api_key_with_every_scope_on_%s', async (path) => {
    const res = await key.get(`/orgs/${orgA}${path}`);
    expect(res.status).toBe(403);
    expect(title(res.body)).toMatch(/does not have a scope for this endpoint/);
  });

  it('should_never_show_pay_or_bill_rates_to_an_api_key_even_where_the_admin_sees_them', async () => {
    const rateKeys = (b: unknown) => (b as Array<Record<string, unknown>>).flatMap((w) => Object.keys(w).filter((k) => /rate/.test(k)));
    expect((await adminA.post(`/orgs/${orgA}/rates`, { kind: 'PAY', scope: 'ORG', amount_minor: 2500, currency: 'USD', effective_from: '2026-01-01' })).status).toBeLessThan(300);
    expect(rateKeys((await adminA.get(`/orgs/${orgA}/workers`)).body)).toContain('pay_rate_minor'); // the control
    expect(rateKeys((await key.get(`/orgs/${orgA}/workers`)).body)).toEqual([]);
  });

  it('should_give_an_api_key_activity_levels_but_never_the_screenshots_an_admin_sees', async () => {
    expect((await adminA.put(`/orgs/${orgA}/policies/ORG/${orgA}`, { screenshots: { enabled: true, perTenMinutes: 1 } })).status).toBe(200);
    const projectId = (await adminA.post(`/orgs/${orgA}/projects`, { name: 'Shots', member_ids: [workerId] })).body.id;
    const sid = newId();
    const at = (ms: number) => new Date(t.clock.now.getTime() + ms).toISOString();
    await device.post('/agent/ingest/batch', { sent_at: at(0), events: [{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: at(0), project_id: projectId }] });
    await device.post('/agent/heartbeat', { sent_at: at(0), session_id: sid });
    const shotId = newId();
    const intent = await device.post('/agent/screenshots/upload-intent', { screenshot_id: shotId, session_id: sid, captured_at: at(60_000), content_type: 'image/webp', bytes: 4 });
    const sent = await device.post('/agent/ingest/batch', {
      sent_at: at(60_000),
      events: [
        { event_id: newId(), type: 'activity.minutes', session_id: sid, occurred_at: at(60_000), minutes: [{ minute_start: at(0), keyboard: 30, mouse: 20, active_seconds: 45, tracked_seconds: 60 }] },
        { event_id: newId(), type: 'screenshot.captured', session_id: sid, occurred_at: at(60_000), screenshot_id: shotId, captured_at: at(60_000), display_index: 0, blurred: false, width: 1920, height: 1080, bytes: 4, sha256: 'a'.repeat(64), storage_key: intent.body.storage_key },
      ],
    });
    expect(sent.body.results.map((r: { status: string }) => r.status)).toEqual(['accepted', 'accepted']);
    const day = `/orgs/${orgA}/activity/day?membership_id=${workerId}&date=${at(0).slice(0, 10)}`;
    const shots = (b: { blocks: Array<{ screenshots: unknown[] }> }) => b.blocks.flatMap((x) => x.screenshots);
    const asAdmin = await adminA.get(day);
    expect(shots(asAdmin.body)).toHaveLength(1); // the control: the screenshot is there
    const asKey = await key.get(day);
    expect(asKey.status).toBe(200);
    expect(asKey.body.blocks.length).toBeGreaterThan(0); // activity levels are open to read:activity
    expect(shots(asKey.body)).toEqual([]);
    expect(JSON.stringify(asKey.body)).not.toContain(shotId);
    expect((await key.get(`/orgs/${orgA}/screenshots?from=${at(0).slice(0, 10)}&to=${at(0).slice(0, 10)}`)).status).toBe(403);
  });
});
