import { request, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../../support/fixtures';
import { ADMIN_STATE, WEB_URL } from '../../../support/env';

/**
 * QA: input validation and user feedback (audit of 30 Oct 2026, VF-xx ids in
 * docs/audit/2026-10-30-validation-feedback-audit.md). The API checks run in a scratch organization
 * the admin owns, so they leave the shared test data alone; the UI checks use the shared workspace.
 */

/** Zod's built-in wording, which is not written for the people using the app. */
const RAW_VALIDATOR = /Too small|Too big|expected (string|number|int|object|array)|Invalid input|Invalid option|must match pattern|>=\s?\d|<=\s?\d/;

type Problem = { status: number; code?: string; title?: string; errors?: Array<{ field: string; message: string }> };
async function problem(res: APIResponse): Promise<Problem> {
  const body = await res.json().catch(() => ({}));
  // The HTTP status wins over a `status` field in a success body (e.g. an invoice's "DRAFT").
  return { ...body, status: res.status() };
}

test.describe('QA · Server-side validation (scratch organization)', () => {
  let api: APIRequestContext;
  let O: string;
  let membershipId: string;
  let clientId: string;
  let projectId: string;

  // Its own admin session: the `adminApi` fixture is per test and closes when beforeAll ends.
  test.beforeAll(async () => {
    api = await request.newContext({ baseURL: WEB_URL, storageState: ADMIN_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    const org = await ok<{ organization_id: string }>(await api.post('/api/v1/me/organizations', { data: { name: `Validation ${uid()}` } }), 'scratch org');
    O = `/api/v1/orgs/${org.organization_id}`;
    const workers = await ok<any>(await api.get(`${O}/workers`), 'workers');
    membershipId = (Array.isArray(workers) ? workers : workers.data)[0].id;
    clientId = (await ok<{ id: string }>(await api.post(`${O}/clients`, { data: { name: `Client ${uid()}` } }), 'client')).id;
    projectId = (await ok<{ id: string }>(await api.post(`${O}/projects`, { data: { name: `Project ${uid()}`, client_id: clientId, member_ids: [membershipId] } }), 'project')).id;
  });
  test.afterAll(async () => api?.dispose());

  test('the rules that hold today keep holding (regression guard)', async () => {
    const reason = 'Forgot to start the timer';
    const cases: Array<[string, Promise<APIResponse>, number]> = [
      ['whitespace-only client name', api.post(`${O}/clients`, { data: { name: '   ' } }), 400],
      ['client name over 150 characters', api.post(`${O}/clients`, { data: { name: 'c'.repeat(151) } }), 400],
      ['negative rate', api.post(`${O}/clients`, { data: { name: `Neg ${uid()}`, bill_rate_minor: -1 } }), 400],
      ['project ends before it starts', api.post(`${O}/projects`, { data: { name: `Dates ${uid()}`, start_date: '2026-12-31', end_date: '2026-01-01' } }), 400],
      ['impossible date', api.post(`${O}/projects`, { data: { name: `Feb ${uid()}`, start_date: '2026-02-30' } }), 400],
      ['manual time ends before it starts', api.post(`${O}/manual-time`, { data: { reason, project_id: projectId, started_at: '2026-10-20T10:00:00Z', ended_at: '2026-10-20T09:00:00Z' } }), 400],
      ['manual time in the future', api.post(`${O}/manual-time`, { data: { reason, project_id: projectId, started_at: '2030-10-20T09:00:00Z', ended_at: '2030-10-20T10:00:00Z' } }), 400],
      ['manual time over 24 hours', api.post(`${O}/manual-time`, { data: { reason, project_id: projectId, started_at: '2026-10-20T00:00:00Z', ended_at: '2026-10-21T06:00:00Z' } }), 400],
      ['manual time with a blank reason', api.post(`${O}/manual-time`, { data: { reason: '   ', project_id: projectId, started_at: '2026-10-20T09:00:00Z', ended_at: '2026-10-20T10:00:00Z' } }), 400],
      ['invoice period ends before it starts', api.post(`${O}/invoices`, { data: { client_id: clientId, period_start: '2026-10-31', period_end: '2026-10-01', issue_date: '2026-10-31', due_date: '2026-11-30' } }), 400],
      ['allocations larger than the payment', api.post(`${O}/payments`, { data: { client_id: clientId, amount_minor: 100, currency: 'USD', received_on: '2026-10-01', allocations: [{ invoice_id: '11111111-1111-4111-8111-111111111111', amount_minor: 500 }] } }), 400],
      ['webhook to a private address', api.post(`${O}/webhooks`, { data: { url: 'https://127.0.0.1:8080/hook', events: ['invoice.sent'] } }), 400],
      ['schedule ends before it starts', api.post(`${O}/schedules`, { data: { membership_id: membershipId, timezone: 'UTC', days: [], effective_from: '2026-11-10', effective_to: '2026-11-01' } }), 400],
    ];
    for (const [what, res, status] of cases) expect.soft((await res).status(), what).toBe(status);

    // Overlapping time is refused, also when the same entry is sent five times at once.
    const slot = { reason, project_id: projectId, started_at: '2026-10-24T09:00:00Z', ended_at: '2026-10-24T10:00:00Z' };
    const burst = await Promise.all(Array.from({ length: 5 }, () => api.post(`${O}/manual-time`, { data: slot })));
    expect(burst.map((r) => r.status()).sort()).toEqual([201, 422, 422, 422, 422]);

    // A duplicate client name is refused even under concurrent submits; unknown properties are ignored.
    const name = `Race ${uid()}`;
    const clients = await Promise.all(Array.from({ length: 4 }, () => api.post(`${O}/clients`, { data: { name, id: '00000000-0000-4000-8000-000000000001', organization_id: '00000000-0000-4000-8000-000000000002' } })));
    expect(clients.map((r) => r.status()).sort()).toEqual([201, 409, 409, 409]);
    const created = await clients.find((r) => r.status() === 201)!.json();
    expect(created.id).not.toBe('00000000-0000-4000-8000-000000000001');
  });

  test('VF-01: validation messages are written for people, not copied from the validator', async () => {
    const samples: Array<[string, Promise<APIResponse>]> = [
      ['client name blank', api.post(`${O}/clients`, { data: { name: ' ' } })],
      ['client name too long', api.post(`${O}/clients`, { data: { name: 'c'.repeat(151) } })],
      ['expense amount zero', api.post(`${O}/expenses`, { data: { category: 'Travel', amount_minor: 0, currency: 'USD', spent_on: '2026-10-01' } })],
      ['task priority unknown', api.post(`${O}/projects/${projectId}/tasks`, { data: { title: 'T', priority: 'CRITICAL' } })],
      ['project colour', api.post(`${O}/projects`, { data: { name: `Colour ${uid()}`, color: 'red' } })],
    ];
    for (const [what, res] of samples) {
      const p = await problem(await res);
      expect(p.status, what).toBe(400);
      expect.soft(p.title, `${what}: title`).not.toMatch(RAW_VALIDATOR);
      for (const e of p.errors ?? []) expect.soft(e.message, `${what}: ${e.field}`).not.toMatch(RAW_VALIDATOR);
    }
  });

  test('VF-02: an invoice cannot be due before it is issued', async () => {
    const res = await api.post(`${O}/invoices`, { data: { client_id: clientId, period_start: '2026-10-01', period_end: '2026-10-31', issue_date: '2026-10-31', due_date: '2026-10-01', extra_lines: [{ description: 'Setup', quantity: 1, unit_price_minor: 100 }] } });
    const p = await problem(res);
    expect(p.status).toBe(400);
    expect(p.errors?.map((e) => e.field)).toContain('due_date');
  });

  test('VF-03: an invoice line too large to store is refused with a field error, not a server error', async () => {
    for (const quantity of [1e9, 1e12]) {
      const p = await problem(await api.post(`${O}/invoices`, { data: { client_id: clientId, period_start: '2026-10-01', period_end: '2026-10-31', issue_date: '2026-10-31', due_date: '2026-11-30', extra_lines: [{ description: 'Big', quantity, unit_price_minor: 1e9 }] } }));
      expect.soft(p.status, `quantity ${quantity}`).toBe(400);
      expect.soft(p.errors?.[0]?.field ?? '', `quantity ${quantity}`).toMatch(/^extra_lines\.0\./);
    }
    // Nothing half-made is left behind.
    const invoices = await ok<any>(await api.get(`${O}/invoices`), 'invoices');
    expect((Array.isArray(invoices) ? invoices : invoices.data).filter((i: any) => i.total_minor >= 1e15)).toEqual([]);
  });

  test('VF-04: renaming a pay group through the API keeps its members and their bank details', async () => {
    const pp = await ok<{ id: string }>(await api.post(`${O}/payroll/profiles`, { data: { name: `Pay ${uid()}`, period: { type: 'weekly' }, currency: 'USD', member_ids: [membershipId] } }), 'pay group');
    await ok(await api.patch(`${O}/payroll/profiles/${pp.id}`, { data: { name: `Pay renamed ${uid()}`, period: { type: 'weekly' }, currency: 'USD' } }), 'rename');
    const list = await ok<any>(await api.get(`${O}/payroll/profiles`), 'pay groups');
    const after = (Array.isArray(list) ? list : list.data).find((p: any) => p.id === pp.id);
    expect(after.members.map((m: { membership_id: string }) => m.membership_id)).toEqual([membershipId]);
  });

  test('VF-05: malformed requests answer 400, not 500', async () => {
    const cases: Array<[string, Promise<APIResponse>]> = [
      ['unknown policy scope', api.put(`${O}/policies/bogus/x`, { data: {} })],
      ['unknown dashboard scope', api.delete(`${O}/dashboard/layout?scope=bogus`)],
      ['receipt sent as JSON', api.post(`${O}/files/receipts`, { data: { a: 1 } })],
      ['project document sent as JSON', api.post(`${O}/projects/${projectId}/documents`, { data: { a: 1 } })],
    ];
    for (const [what, res] of cases) expect.soft((await res).status(), what).toBe(400);
  });

  test('VF-06: a report refuses a reversed or unbounded date range', async () => {
    const reports = await ok<any>(await api.get(`${O}/reports`), 'reports');
    const key = (Array.isArray(reports) ? reports : reports.data)[0].key;
    expect.soft((await api.post(`${O}/reports/${key}/query`, { data: { from: '2026-12-31', to: '2026-01-01' } })).status(), 'from after to').toBe(400);
    expect.soft((await api.post(`${O}/reports/${key}/query`, { data: { from: '0001-01-01', to: '9999-12-31' } })).status(), '10 000-year range').toBe(400);
  });

  test('VF-07: small input slips are refused (expired API key, unknown webhook event, padded payment reference)', async () => {
    expect.soft((await api.post(`${O}/api-keys`, { data: { name: 'Already expired', scopes: ['read:time'], expires_at: '2020-01-01T00:00:00Z' } })).status(), 'API key expiring in the past').toBe(400);
    expect.soft((await api.post(`${O}/webhooks`, { data: { url: 'https://example.com/hook', events: ['made.up'] } })).status(), 'unknown webhook event').toBe(400);
    const ref = `CHK-${uid()}`;
    await ok(await api.post(`${O}/payments`, { data: { client_id: clientId, amount_minor: 100, currency: 'USD', received_on: '2026-10-01', provider_ref: ref } }), 'payment');
    expect.soft((await api.post(`${O}/payments`, { data: { client_id: clientId, amount_minor: 100, currency: 'USD', received_on: '2026-10-01', provider_ref: ` ${ref}` } })).status(), 'same reference with a space').toBe(409);
  });

  test('VF-08: an oversized request body is refused before it is read', async () => {
    const res = await api.post(`${O}/clients`, { headers: { 'content-type': 'application/json' }, data: JSON.stringify({ name: 'big', notes: 'x'.repeat(5_000_000) }) });
    expect(res.status()).toBe(413);
  });
});

test.describe('QA · Form feedback in the browser (signed out)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('VF-14: "reset link on its way" is not claimed when the request failed', async ({ page }) => {
    // Unknown and known addresses get the same answer on purpose; a failed request is a different case.
    await page.route('**/api/v1/auth/password/forgot', (route) => route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Something went wrong on our side', status: 500, code: 'internal_error' }) }));
    await page.goto('/forgot-password');
    await page.getByLabel('Work email').fill('someone@example.com');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible();
    await expect(page.getByText(/a reset link is on its way/)).toHaveCount(0);
  });
});

test.describe('QA · Form feedback in the browser (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  async function openNewClient(page: Page, orgId: string) {
    await page.goto(`/o/${orgId}/clients`);
    await page.getByRole('button', { name: 'New client' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New client' });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test('a blank client name cannot be submitted; a duplicate is explained on the field and the input is kept', async ({ page, data, adminApi }) => {
    const existing = `Dup ${uid()}`;
    await ok(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: existing } }), 'client');
    const dialog = await openNewClient(page, data.orgId);
    const name = dialog.getByLabel('Company / client name');
    const create = dialog.getByRole('button', { name: 'Create client' });
    await name.fill('    ');
    await expect(create).toBeDisabled();
    await name.fill(existing.toLowerCase());
    await dialog.getByLabel('Contact person').fill('Kept Contact');
    await create.click();
    await expect(dialog.getByText('Use another name, or archive the other client')).toBeVisible();
    await expect(page.getByText('Client created')).toHaveCount(0);
    await expect(name).toHaveValue(existing.toLowerCase());
    await expect(dialog.getByLabel('Contact person')).toHaveValue('Kept Contact');
  });

  test('a server error keeps the dialog and the input, and never shows success', async ({ page, data }) => {
    const dialog = await openNewClient(page, data.orgId);
    await page.route('**/api/v1/orgs/*/clients', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ type: 'about:blank', title: 'Something went wrong on our side', status: 500, code: 'internal_error', request_id: 'req-1' }) })
        : route.continue(),
    );
    await dialog.getByLabel('Company / client name').fill('Server error Ltd');
    await dialog.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByText('Something went wrong on our side')).toBeVisible();
    await expect(page.getByText('Client created')).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Company / client name')).toHaveValue('Server error Ltd');
  });

  test('VF-09: a lost connection is explained in plain words', async ({ page, data }) => {
    const dialog = await openNewClient(page, data.orgId);
    await page.route('**/api/v1/orgs/*/clients', (route) => (route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue()));
    await dialog.getByLabel('Company / client name').fill('Offline Ltd');
    await dialog.getByRole('button', { name: 'Create client' }).click();
    // Read the toast while it is up (it hides after 4 seconds).
    const live = page.locator('[aria-live]').filter({ hasText: /\S/ });
    await expect(live).toBeVisible();
    const shown = (await live.innerText()).trim();
    expect(shown, `the person was shown: "${shown}"`).toMatch(/connection|offline|could not reach/i);
    await expect(dialog.getByLabel('Company / client name')).toHaveValue('Offline Ltd');
  });

  test('VF-10: an error toast is announced and can be dismissed', async ({ page, data }) => {
    const dialog = await openNewClient(page, data.orgId);
    await page.route('**/api/v1/orgs/*/clients', (route) =>
      route.request().method() === 'POST' ? route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Something went wrong on our side', status: 500, code: 'internal_error' }) }) : route.continue(),
    );
    await dialog.getByLabel('Company / client name').fill('Toast Ltd');
    await dialog.getByRole('button', { name: 'Create client' }).click();
    const toast = page.locator('[aria-live]').filter({ hasText: 'Something went wrong on our side' });
    await expect(toast).toBeVisible();
    // Errors interrupt (role=alert or aria-live=assertive) and stay until read or dismissed.
    const assertive = await toast.evaluate((el) => el.getAttribute('aria-live') === 'assertive' || !!el.querySelector('[role="alert"]'));
    expect.soft(assertive, 'error toast is announced assertively').toBe(true);
    await expect(toast.getByRole('button', { name: /dismiss|close/i })).toBeVisible();
  });

  test('VF-11: when the session has expired, the sign-in page says so', async ({ page, data }) => {
    const dialog = await openNewClient(page, data.orgId);
    await page.route('**/api/v1/orgs/**', (route) => route.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Sign in to continue', status: 401, code: 'unauthenticated' }) }));
    await dialog.getByLabel('Company / client name').fill('Expired Ltd');
    await dialog.getByRole('button', { name: 'Create client' }).click();
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.getByText(/session (has )?(expired|ended)|signed out/i)).toBeVisible();
  });

  test('VF-12: an unknown address shows a page with a way back', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('link', { name: /home|dashboard|back|workspace|sign in/i })).toBeVisible();
  });
});
