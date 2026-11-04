import { request, type APIRequestContext } from '@playwright/test';
import { expect, ok, test, uid } from '../../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE, WEB_URL, WORKER_STATE } from '../../../support/env';

/**
 * QA: authorization is enforced by the server, not only hidden in the UI. Every check here calls the
 * API directly with a real session, device token or nothing, as an attacker would, and reads the
 * status and the problem+json body. The UI side of the same rules is covered by the page specs.
 */

const NONE = { cookies: [], origins: [] };
const session = (storageState: string | typeof NONE) => request.newContext({ baseURL: WEB_URL, storageState, extraHTTPHeaders: { Origin: WEB_URL } });

async function problem(res: Awaited<ReturnType<APIRequestContext['get']>>) {
  expect(res.headers()['content-type']).toContain('application/problem+json');
  return (await res.json()) as { status: number; code: string; title: string };
}

/** Endpoints only an organization-wide admin may read. */
const ADMIN_ONLY = ['/payroll/runs', '/api-keys', '/audit-logs', '/webhooks', '/invoices', '/rates', '/permissions/review'];

test.describe('QA · API authorization (server side)', () => {
  test('signed out: every organization endpoint answers 401 and returns no data', { tag: '@smoke' }, async ({ data }) => {
    const anon = await session(NONE);
    for (const path of ['/workers', '/projects', '/clients', '/budgets', '/roles', ...ADMIN_ONLY, `/pay-stubs/${data.payStub.id}`]) {
      const res = await anon.get(`/api/v1/orgs/${data.orgId}${path}`);
      expect(res.status(), path).toBe(401);
      expect((await problem(res)).code, path).toBe('unauthenticated');
    }
    await anon.dispose();
  });

  test('a worker is refused admin-only data with 403', async ({ data }) => {
    const worker = await session(WORKER_STATE);
    for (const path of [...ADMIN_ONLY, '/budgets']) {
      const res = await worker.get(`/api/v1/orgs/${data.orgId}${path}`);
      expect(res.status(), path).toBe(403);
      expect((await problem(res)).code, path).toBe('forbidden');
    }
    await worker.dispose();
  });

  test('a custom role sees what it was granted (budgets) and nothing about money or people', async ({ data }) => {
    const viewer = await session(VIEWER_STATE);
    expect((await viewer.get(`/api/v1/orgs/${data.orgId}/budgets`)).status()).toBe(200);
    for (const path of [...ADMIN_ONLY, '/clients', '/projects', '/screenshots']) {
      expect((await viewer.get(`/api/v1/orgs/${data.orgId}${path}`)).status(), path).toBe(403);
    }
    await viewer.dispose();
  });

  test('lists are narrowed to what the caller may see', async ({ data, adminApi }) => {
    const worker = await session(WORKER_STATE);
    const o = (p: string) => `/api/v1/orgs/${data.orgId}${p}`;

    // People: an own-scope member sees only themselves, and another member's record is "not found".
    const people = await ok<Array<{ id: string }>>(await worker.get(o('/workers')), 'workers');
    expect(people.map((p) => p.id)).toEqual([data.worker.membershipId]);
    expect((await worker.get(o(`/workers/${data.admin.membershipId}`))).status()).toBe(404);

    // Projects: only those the worker is assigned to (the admin sees more).
    const mine = await ok<Array<{ id: string }>>(await worker.get(o('/projects')), 'worker projects');
    const all = await ok<Array<{ id: string }>>(await adminApi.api.get(adminApi.orgApi('/projects')), 'admin projects');
    expect(mine.map((p) => p.id)).toContain(data.projects.website.id);
    expect(mine.map((p) => p.id)).not.toContain(data.projects.app.id);
    expect(all.length).toBeGreaterThan(mine.length);
    await worker.dispose();
  });

  test('a pay stub is readable by its owner only (no IDOR by id)', async ({ data }) => {
    const path = `/api/v1/orgs/${data.orgId}/pay-stubs/${data.payStub.id}`;
    const worker = await session(WORKER_STATE);
    const viewer = await session(VIEWER_STATE);
    expect((await worker.get(path)).status()).toBe(200);
    const res = await viewer.get(path);
    expect(res.status()).toBe(404);
    expect(await res.text()).not.toContain(String(data.payStub.netMinor));
    await Promise.all([worker.dispose(), viewer.dispose()]);
  });

  test('a desktop device cannot read another worker\'s pay stub or call the admin API', async ({ data, newcomerDevice }) => {
    const api = await request.newContext({ baseURL: WEB_URL, storageState: NONE });
    const auth = { Authorization: `Bearer ${newcomerDevice.token}` };
    // Wade's pay stub, asked for with Nina's device.
    expect((await api.get(`/api/v1/agent/me/pay-stubs/${data.payStub.id}/pdf`, { headers: auth })).status()).toBe(404);
    for (const path of ['/payroll/runs', '/workers', '/roles']) {
      const status = (await api.get(`/api/v1/orgs/${data.orgId}${path}`, { headers: auth })).status();
      expect([401, 403], path).toContain(status);
    }
    await api.dispose();
  });

  test('a worker cannot create roles or API keys, or make themselves an admin', async ({ data, adminApi }) => {
    const worker = await session(WORKER_STATE);
    const o = (p: string) => `/api/v1/orgs/${data.orgId}${p}`;
    const roles = await ok<Array<{ id: string; key: string }>>(await adminApi.api.get(adminApi.orgApi('/roles')), 'roles');
    const adminRole = roles.find((r) => r.key === 'SYSTEM_ADMIN')!;

    expect((await worker.post(o('/roles'), { data: { name: `Escalate ${uid()}`, grants: { 'org:update': 'org' } } })).status()).toBe(403);
    expect((await worker.post(o('/api-keys'), { data: { name: `Key ${uid()}`, scopes: ['read:workers'] } })).status()).toBe(403);
    const promote = await worker.patch(o(`/workers/${data.worker.membershipId}`), { data: { role_id: adminRole.id } });
    expect(promote.status()).toBe(403);

    // The role really did not change.
    const me = await ok<{ role_id: string }>(await adminApi.api.get(adminApi.orgApi(`/workers/${data.worker.membershipId}`)), 'worker');
    expect(me.role_id).not.toBe(adminRole.id);
    await worker.dispose();
  });

  test('another organization is invisible to a member of this one (tenant isolation)', async ({ data, adminApi }) => {
    // The admin owns a second organization; Wade is only a member of the first.
    const created = await ok<{ organization_id: string }>(await adminApi.api.post('/api/v1/me/organizations', { data: { name: `Tenant B ${uid()}` } }), 'second org');
    const other = created.organization_id;
    const worker = await session(WORKER_STATE);
    for (const path of ['', '/workers', '/projects', '/payroll/runs']) {
      const res = await worker.get(`/api/v1/orgs/${other}${path}`);
      expect([403, 404], path || '/').toContain(res.status());
      expect(await res.text()).not.toContain('Tenant B');
    }
    // A made-up organization id answers the same way as a real one the caller is not in.
    expect((await worker.get('/api/v1/orgs/00000000-0000-4000-8000-000000000000/workers')).status()).toBe(404);
    await worker.dispose();
  });
});

test.describe('QA · Request forgery and credentials', () => {
  test('a signed-in browser request from another site is blocked (CSRF)', async () => {
    const worker = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE });
    const evil = await worker.patch('/api/v1/me', { data: { tour: 'done' }, headers: { Origin: 'https://evil.example' } });
    expect(evil.status()).toBe(403);
    expect((await problem(evil)).code).toBe('csrf_origin_mismatch');
    const missing = await worker.patch('/api/v1/me', { data: { tour: 'done' } });
    expect(missing.status()).toBe(403);
    expect((await problem(missing)).code).toBe('csrf_origin_missing');
    await worker.dispose();
  });

  test('a form-encoded or text body is refused, so a plain HTML form cannot post to the API', async () => {
    const worker = await session(WORKER_STATE);
    const res = await worker.patch('/api/v1/me', { data: '{"tour":"done"}', headers: { 'Content-Type': 'text/plain' } });
    expect(res.status()).toBe(400);
    expect((await problem(res)).code).toBe('unsupported_media_type');
    await worker.dispose();
  });

  test('a signed-out sign-in attempt from another site is blocked (login CSRF)', async ({ data }) => {
    const anon = await request.newContext({ baseURL: WEB_URL, storageState: NONE });
    // Wrong password on purpose: if the origin check were missing this would only count a failed attempt.
    const res = await anon.post('/api/v1/auth/login', { data: { email: data.viewer.email, password: 'x'.repeat(12) }, headers: { Origin: 'https://evil.example' } });
    expect(res.status()).toBe(403);
    await anon.dispose();
  });

  test('forged, malformed and unknown credentials are rejected with 401', async ({ data }) => {
    const anon = await request.newContext({ baseURL: WEB_URL, storageState: NONE });
    const path = `/api/v1/orgs/${data.orgId}/workers`;
    const cases: Array<[string, Record<string, string>, string]> = [
      ['bad bearer', { Authorization: 'Bearer not-a-token' }, 'invalid_token'],
      ['tampered device token', { Authorization: 'Bearer eyJkIjoieCJ9.forged' }, 'invalid_token'],
      ['unknown API key', { Authorization: `Bearer tw_live_${uid()}_${uid()}${uid()}` }, 'invalid_api_key'],
      ['forged session cookie', { Cookie: `tw_session=${uid()}${uid()}${uid()}` }, 'unauthenticated'],
    ];
    for (const [name, headers, code] of cases) {
      const res = await anon.get(path, { headers });
      expect(res.status(), name).toBe(401);
      expect((await problem(res)).code, name).toBe(code);
    }
    await anon.dispose();
  });

  test('error responses do not leak stack traces or internals', async ({ data }) => {
    const anon = await request.newContext({ baseURL: WEB_URL, storageState: NONE });
    for (const [method, path, body] of [
      ['GET', `/api/v1/orgs/not-a-uuid/workers`, undefined],
      ['POST', '/api/v1/auth/login', '{"email":'],
      ['GET', `/api/v1/orgs/${data.orgId}/no-such-route`, undefined],
    ] as const) {
      const res = await anon.fetch(path, { method, data: body, headers: body ? { 'Content-Type': 'application/json' } : {} });
      expect(res.status(), path).toBeGreaterThanOrEqual(400);
      expect(res.status(), path).toBeLessThan(500);
      const text = await res.text();
      expect(text, path).not.toMatch(/at \S+ \(|node_modules|\.ts:\d+|SELECT |postgres|PGlite/i);
    }
    await anon.dispose();
  });
});

test.describe('QA · Security headers', () => {
  test('pages and API responses carry the hardening headers', async ({ page, data }) => {
    const res = await page.goto('/login');
    const h = res!.headers();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['strict-transport-security']).toContain('max-age=');
    expect(h['permissions-policy']).toContain('camera=()');
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-powered-by']).toBeUndefined();

    const api = await request.newContext({ baseURL: WEB_URL, storageState: NONE });
    const apiRes = await api.get(`/api/v1/orgs/${data.orgId}/workers`);
    expect(apiRes.headers()['x-powered-by']).toBeUndefined();
    expect(apiRes.headers()['access-control-allow-origin'] ?? '').not.toBe('*');
    await api.dispose();
  });

  test('the session cookie is HttpOnly and SameSite', async ({ browser, data }) => {
    const ctx = await browser.newContext({ storageState: ADMIN_STATE });
    const cookie = (await ctx.cookies()).find((c) => c.name === 'tw_session');
    expect(cookie, 'session cookie').toBeTruthy();
    expect(cookie!.httpOnly).toBe(true);
    expect(['Lax', 'Strict']).toContain(cookie!.sameSite);
    // A script on the page cannot read it.
    const page = await ctx.newPage();
    await page.goto(`/o/${data.orgId}`);
    expect(await page.evaluate(() => document.cookie)).not.toContain('tw_session');
    await ctx.close();
  });
});
