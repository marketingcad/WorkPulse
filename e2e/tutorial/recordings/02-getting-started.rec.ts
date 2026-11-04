import { request } from '@playwright/test';
import { totpNow } from '../../support/totp';
import { STATE, TUTORIAL_URL } from '../env';
import { expect, test } from '../kit';

/** The owner who signs up in 02.1 and is used again in 02.2 and 02.4. */
const OWNER = { name: 'Jordan Lee', org: 'Brightside Studio', email: 'jordan@brightside.example', password: 'Brightside-2026!' };

test('02.1', async ({ d, page }) => {
  await d.go('!/signup');
  d.begin();
  await d.mark('zoom to the form', page.getByLabel('Your name'));
  await d.type(page.getByLabel('Your name'), OWNER.name);
  await d.type(page.getByLabel('Organization name'), OWNER.org);
  await d.type(page.getByLabel('Work email'), OWNER.email);
  await d.type(page.getByLabel('Password', { exact: true }), OWNER.password);
  await d.mark('password hint', page.getByText('At least 10 characters.'));
  await d.click(page.getByRole('button', { name: 'Create organization' }));
  const checklist = page.getByRole('list', { name: 'Getting started' });
  await expect(checklist).toBeVisible();
  await d.mark('zoom to the Getting started checklist', checklist);
  for (const step of ['Invite your team', 'Create a project', 'Set pay and bill rates', 'Connect the desktop app', 'Review what is tracked']) {
    await d.point(checklist.getByRole('link', { name: new RegExp(step) }), { hold: 1100 });
  }
  await d.finish();
});

test('02.2', async ({ d, page }) => {
  await d.go('!/login');
  await expect(page.getByRole('heading', { name: 'Welcome Back' })).toBeVisible();
  d.begin();
  await d.beat(1500);
  const forgot = page.getByRole('link', { name: 'Forgot password?' });
  await d.mark('highlight Forgot password?', forgot);
  await d.click(forgot);
  await d.type(page.getByLabel('Work email'), OWNER.email);
  await d.click(page.getByRole('button', { name: 'Send reset link' }));
  await d.mark('zoom to the confirmation', page.getByText(OWNER.email).first());
  await d.beat(3500);
  await d.click(page.getByRole('link', { name: 'Back to sign in' }));
  await d.type(page.getByLabel('Work email'), OWNER.email);
  await d.type(page.getByLabel('Password', { exact: true }), OWNER.password);
  await d.click(page.getByRole('button', { name: 'Show password' }), { settle: false });
  await d.beat(1200);
  await d.click(page.getByRole('button', { name: 'Sign in' }));
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await d.finish();
});

test('02.3', async ({ d, page }) => {
  // The admin of the demo company invites a new manager (as in chapter 5), before the scene starts.
  const admin = await request.newContext({ baseURL: TUTORIAL_URL, storageState: STATE.admin, extraHTTPHeaders: { Origin: TUTORIAL_URL } });
  const roles: Array<{ id: string; key: string }> = await (await admin.get(`/api/v1/orgs/${d.data.orgId}/roles`)).json();
  const invite = await admin.post(`/api/v1/orgs/${d.data.orgId}/invitations`, { data: { email: 'sam.rivera@demo.tallywork.app', name: 'Sam Rivera', role_id: roles.find((r) => r.key === 'TEAM_MANAGER')!.id } });
  expect(invite.ok(), await invite.text()).toBe(true);
  const link = new URL((await invite.json()).invite_url as string);
  await admin.dispose();

  await d.go(`!${link.pathname}${link.search}`);
  await expect(page.getByRole('heading', { name: 'You have been invited' })).toBeVisible();
  d.begin();
  await d.mark('zoom to the invitation form', page.getByLabel('Your name'));
  await d.point(page.getByLabel('Your name'), { hold: 1500 });
  await d.type(page.getByLabel('Choose a password'), 'Rivera-Team-2026');
  await d.click(page.getByRole('button', { name: 'Join organization' }));
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await d.finish();
});

test('02.4', async ({ d, page }) => {
  // Signed in as the owner from 02.1 (the cookie goes into this page's browser context).
  const login = await page.request.post('/api/v1/auth/login', { data: { email: OWNER.email, password: OWNER.password }, headers: { Origin: TUTORIAL_URL } });
  expect(login.ok(), await login.text()).toBe(true);
  const orgId = ((await (await page.request.get('/api/v1/me')).json()) as { organizations: Array<{ id: string }> }).organizations[0]!.id;
  await page.request.patch('/api/v1/me', { data: { tour: 'done' }, headers: { Origin: TUTORIAL_URL } });
  await d.go(`!/o/${orgId}`);
  d.begin();
  await d.click(page.getByRole('button', { name: 'Account menu' }), { settle: false });
  await d.click(page.getByRole('menuitem', { name: 'Profile & devices' }));
  const panel = page.locator('#two-factor');
  await d.scrollTo(panel);
  await d.click(panel.getByRole('button', { name: 'Set up' }), { settle: false });
  await d.type(panel.getByLabel('Password'), OWNER.password);
  await d.click(panel.getByRole('button', { name: 'Continue' }), { settle: false });
  const qr = panel.getByRole('img', { name: 'QR code to add WorkPulse to your authenticator app' });
  await expect(qr).toBeVisible();
  await d.mark('zoom to the QR code', qr);
  await d.point(qr, { hold: 3000 });
  const key = (await panel.locator('code').first().textContent())!.replace(/\s/g, '');
  await d.type(panel.getByLabel('Code', { exact: true }), totpNow(key));
  await d.click(panel.getByRole('button', { name: 'Turn on' }), { settle: false });
  const codes = panel.locator('pre, code').filter({ hasText: /[a-z2-9]{5}-[a-z2-9]{5}/ }).first();
  await expect(codes).toBeVisible();
  await d.mark('zoom to the recovery codes', codes);
  await d.point(codes, { hold: 2500 });
  await d.point(panel.getByRole('button', { name: 'Download' }), { hold: 1500 });
  await d.click(panel.getByLabel('I have saved these codes somewhere safe'), { settle: false });
  await d.mark('the Done button', panel.getByRole('button', { name: 'Done' }));
  await d.click(panel.getByRole('button', { name: 'Done' }), { settle: false });
  await expect(panel.getByText('On', { exact: true })).toBeVisible();
  await d.finish();
});

