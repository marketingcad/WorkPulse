import AxeBuilder from '@axe-core/playwright';
import { request, type Page, type Route } from '@playwright/test';
import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD, WEB_URL } from '../../support/env';

/**
 * The support console (/support) for WorkPulse staff.
 *
 * Against the real test server: invisible to everyone else, and a staff account that has not yet
 * proven its mailbox is told so. Staff must have opened a verification or password-reset link
 * (AUTH-005), and this server cannot hand a test that link without logging email bodies, which
 * production must never do (AUTH-010). So the console's screens after that point run on recorded
 * API answers; the rules behind them (two-factor, grant, expiry, revocation, audit as "support")
 * are proven on the real API in packages/api/test/support.test.ts.
 *
 * The staff address is the test server's SUPPORT_STAFF_EMAILS (e2e/scripts/serve-web.mjs).
 */
const STAFF = 'support-staff@e2e.test';

test.describe('Support console on the real server', () => {
  test.describe.configure({ mode: 'serial' });

  test('is a plain "page not found" to someone who is not staff', async ({ browser }) => {
    const admin = await browser.newContext({ storageState: ADMIN_STATE });
    const page = await admin.newPage();
    await page.goto('/support');
    await expect(page.getByText('Page not found')).toBeVisible();
    await expect(page.getByText('Support console')).toHaveCount(0);
    expect((await page.request.get('/api/v1/support/orgs?q=e2e')).status()).toBe(404);
    await admin.close();
  });

  // Defect D-9 (6 Nov 2026): every refusal read "Two-factor authentication required", so staff who
  // had not confirmed their email were told to sign in again with a code, which could never work.
  test('tells staff who have not confirmed their email address to do that first', async ({ browser, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    // A staff account that belongs to no organization: accepted an invitation, then removed. Runs once
    // per server (the address can be invited only once), without using one of the run's sign-ups.
    const roles = await ok<Array<{ id: string; key: string }>>(await api.get(orgApi('/roles')), 'roles');
    const invite = await ok<{ invite_url: string }>(await api.post(orgApi('/invitations'), { data: { email: STAFF, name: 'Sam Support', role_id: roles.find((r) => r.key === 'WORKER')!.id } }), 'invite');
    const staffApi = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL } });
    const token = new URL(invite.invite_url).searchParams.get('token')!;
    const accepted = await ok<{ membership_id: string }>(await staffApi.post('/api/v1/auth/invitations/accept', { data: { token, name: 'Sam Support', password: PASSWORD } }), 'accept');
    expect((await api.delete(orgApi(`/workers/${accepted.membership_id}`))).status()).toBe(204);

    const staff = await browser.newContext({ storageState: await staffApi.storageState() });
    const page = await staff.newPage();
    try {
      await page.goto('/support');
      await expect(page.getByText('Confirm your email address first')).toBeVisible();
      await expect(page.getByText('Two-factor authentication required')).toHaveCount(0);
      const me = await staffApi.get('/api/v1/support/me');
      expect([me.status(), (await me.json()).code]).toEqual([403, 'support_email_unproven']);
      // Staff are not members (a former member, here): the customer's workspace API stays closed.
      expect([403, 404]).toContain((await staffApi.get(`/api/v1/orgs/${data.orgId}/workers`)).status());
    } finally {
      await staff.close();
      await staffApi.dispose();
    }
  });
});

// ─── The console's screens, on recorded answers ────────────────────────────────────────────────────

const ORG = { id: '0190a000-0000-7000-8000-00000000a001', name: 'Acme Robotics', slug: 'acme-robotics', timezone: 'Europe/Berlin', currency: 'EUR', created_at: '2026-09-01T09:00:00Z' };
const overview = (grant: { expires_at: string; reason: string } | null) => ({
  organization: ORG,
  owner: { name: 'Cleo Owner', email: 'cleo@acme.test' },
  members: 2,
  devices: { ACTIVE: 1 },
  agent_versions: { '0.2.0': 1 },
  live_sessions: 0,
  last_time_entry_at: '2026-11-05T15:00:00Z',
  health: { parked_events: 0, webhooks: { endpoints: 0, disabled: 0, failing: 0 }, integrations_in_error: 0, exports_failed_24h: 0 },
  security: { enforce_mfa: 'admins', session_ttl_hours: 12, ip_allowlist_ranges: 0, device_approval: false },
  support_access: grant,
});
const GRANT = { expires_at: '2026-11-06T18:00:00Z', reason: 'Timesheets look wrong for Walt' };
const DETAILS = {
  grant: GRANT,
  members: [{ membership_id: 'm1', name: 'Walt Worker', email: 'walt@acme.test', role: 'Worker', status: 'ACTIVE', is_owner: false }],
  devices: [{ id: 'd1', name: 'Walt-PC', platform: 'windows', status: 'ACTIVE', version: '0.2.0', lastSeenAt: '2026-11-06T10:00:00Z', lastSyncAt: '2026-11-06T10:00:00Z' }],
  audit: [{ action: 'support.details_viewed', actor_type: 'support', target_type: 'organization', created_at: '2026-11-06T10:05:00Z' }],
};
const json = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: status < 400 ? 'application/json' : 'application/problem+json', body: JSON.stringify(body) });

async function mockConsole(page: Page, opts: { me?: 'ok' | 'mfa'; grant?: boolean; details?: 'ok' | 'fail' } = {}) {
  await page.route('**/api/v1/support/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/support/me')) return opts.me === 'mfa' ? json(route, 403, { title: 'The support console needs a session verified with two-factor authentication', status: 403, code: 'support_mfa_required' }) : json(route, 200, { email: STAFF });
    if (p.endsWith('/details')) return opts.details === 'fail' ? json(route, 500, { title: 'Something went wrong on our side', status: 500, code: 'internal_error' }) : json(route, 200, DETAILS);
    if (p.endsWith(`/support/orgs/${ORG.id}`)) return json(route, 200, overview(opts.grant ? GRANT : null));
    if (p.endsWith('/support/orgs')) return json(route, 200, [{ id: ORG.id, name: ORG.name, slug: ORG.slug, created_at: ORG.created_at }]);
    return json(route, 404, { title: 'Not found', status: 404, code: 'not_found' });
  });
}
async function openAcme(page: Page) {
  await page.goto('/support');
  await expect(page.getByRole('heading', { level: 1, name: 'Support console' })).toBeVisible();
  await page.getByPlaceholder('Organization name, slug, id or owner email').fill('acme');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('row').filter({ hasText: ORG.name }).first().click();
  await expect(page.getByRole('heading', { name: ORG.name })).toBeVisible();
}

test.describe('Support console screens', () => {
  test.use({ storageState: ADMIN_STATE });

  test('without two-factor it says so and how to fix it', async ({ page }) => {
    await mockConsole(page, { me: 'mfa' });
    await page.goto('/support');
    await expect(page.getByText('Two-factor authentication required')).toBeVisible();
    await expect(page.getByText('Sign out and sign in again with your code.', { exact: false })).toBeVisible();
  });

  test('without a grant: the organization’s metadata only, and how to get access', { tag: '@smoke' }, async ({ page }) => {
    await mockConsole(page, { grant: false });
    await openAcme(page);
    await expect(page.getByText(`Signed in as ${STAFF}.`, { exact: false })).toBeVisible();
    await expect(page.getByText('Cleo Owner · cleo@acme.test')).toBeVisible();
    await expect(page.getByText('Not shared. Ask an admin of this organization to grant support access', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Members', exact: true })).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });

  test('with a grant: members, devices and the audit log, with the grant’s end and reason shown', async ({ page }) => {
    await mockConsole(page, { grant: true });
    await openAcme(page);
    await expect(page.getByRole('status').filter({ hasText: 'Access granted until' })).toContainText(GRANT.reason);
    for (const h of ['Members', 'Devices', 'Audit log (latest 200)']) await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible();
    // Tables also render a phone layout, so each value appears twice: check the table cells.
    await expect(page.getByRole('cell', { name: 'walt@acme.test' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Walt-PC' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'support.details_viewed' })).toBeVisible();
  });

  test('when the details fail to load it says so and can try again', async ({ page }) => {
    await mockConsole(page, { grant: true, details: 'fail' });
    await openAcme(page);
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong on our side' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});
