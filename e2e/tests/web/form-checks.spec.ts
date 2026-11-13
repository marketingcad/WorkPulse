import { request, type Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, WEB_URL } from '../../support/env';

/**
 * QA audit, 11 Nov 2026 (Phase 5): forms that sent obviously wrong input to the server and only then
 * showed a vaguer error. Each is now checked in the form, with the server's wording, and nothing is
 * sent; the server still refuses the same input on its own. The join page reads the invitation first.
 * No invitation is accepted here (accepting is rate-limited across the whole run).
 */
test.use({ storageState: ADMIN_STATE });

/** Counts write requests to an API path, to prove a form sent nothing. */
function countWrites(page: Page, path: RegExp) {
  const sent = { n: 0 };
  page.on('request', (r) => {
    if (r.method() !== 'GET' && path.test(new URL(r.url()).pathname)) sent.n++;
  });
  return sent;
}

test('Invite member checks the email in the form and sends nothing', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
  await page.goto(`/o/${data.orgId}/workers`);
  await page.getByRole('button', { name: 'Invite member', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Invite member' });
  const sent = countWrites(page, /\/invitations$/);
  await dialog.getByLabel('Email').fill('not-an-email');
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(dialog.getByText('Enter a valid email address, like name@example.com')).toBeVisible();
  expect(sent.n).toBe(0);
  // The server still refuses it on its own.
  const roles = await ok<Array<{ id: string; key: string }>>(await adminApi.api.get(adminApi.orgApi('/roles')), 'roles');
  const r = await adminApi.api.post(adminApi.orgApi('/invitations'), { data: { email: 'not-an-email', role_id: roles.find((x) => x.key === 'WORKER')!.id } });
  expect(r.status()).toBe(400);
});

test('New client checks the contact email in the form and sends nothing', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/clients`);
  await page.getByRole('button', { name: 'New client', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New client' });
  const sent = countWrites(page, /\/clients$/);
  await dialog.getByLabel(/Company \/ client name/).fill(`Checked ${uid()}`);
  await dialog.getByLabel('Contact email').fill('bad-email');
  await dialog.getByRole('button', { name: 'Create client' }).click();
  await expect(dialog.getByText('Enter a valid email address, like name@example.com')).toBeVisible();
  expect(sent.n).toBe(0);
});

test('New project checks the date order in the form and sends nothing', async ({ page, data, adminApi }) => {
  await page.goto(`/o/${data.orgId}/projects`);
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  await page.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New project' });
  const sent = countWrites(page, /\/projects$/);
  await dialog.getByRole('textbox', { name: /^Name/ }).fill(`Dates ${uid()}`);
  await dialog.getByLabel('Start date').fill('2026-12-31');
  await dialog.getByLabel('End date').fill('2026-01-01');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog.getByText('Must be on or after the start date')).toBeVisible();
  expect(sent.n).toBe(0);
  const r = await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Dates ${uid()}`, start_date: '2026-12-31', end_date: '2026-01-01' } });
  expect(r.status()).toBe(400);
});

test.describe('The join page reads the invitation first', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the inviter’s name and the organization are shown, and a short password is caught before sending', async ({ page, data }) => {
    // The invitation is created as the admin; the page is opened signed out, as the invitee would.
    const api = await request.newContext({ baseURL: WEB_URL, storageState: ADMIN_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    const roles = await ok<Array<{ id: string; key: string }>>(await api.get(`/api/v1/orgs/${data.orgId}/roles`), 'roles');
    const inv = await ok<{ invite_url: string }>(await api.post(`/api/v1/orgs/${data.orgId}/invitations`, { data: { email: `join+${uid()}@e2e.test`, name: 'Jo Joiner', role_id: roles.find((x) => x.key === 'WORKER')!.id } }), 'invite');
    const orgName = (await ok<{ organization: { name: string } }>(await api.get(`/api/v1/orgs/${data.orgId}`), 'org')).organization.name;
    await api.dispose();

    await page.goto(new URL(inv.invite_url).pathname + new URL(inv.invite_url).search);
    await expect(page.getByLabel('Your name')).toHaveValue('Jo Joiner');
    await expect(page.getByText(`Set up your account to join ${orgName} on WorkPulse.`)).toBeVisible();
    const sent = countWrites(page, /\/auth\/invitations\/accept$/);
    await page.getByLabel('Choose a password').fill('short');
    await page.getByRole('button', { name: 'Join organization' }).click();
    await expect(page.getByText('Use at least 10 characters')).toBeVisible();
    expect(sent.n).toBe(0);
  });

  test('an unusable link says so straight away, with no form to fill in', async ({ page }) => {
    await page.goto(`/invite?token=${'x'.repeat(43)}`);
    // Next.js has an alert region of its own (route announcer), so this one is found by its text.
    await expect(page.getByRole('alert').filter({ hasText: 'This invitation is invalid' })).toHaveText('This invitation is invalid or has expired. Ask the person who invited you to send a new one.');
    await expect(page.getByLabel('Choose a password')).toHaveCount(0);
  });
});
