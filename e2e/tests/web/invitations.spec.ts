import type { Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD } from '../../support/env';

/**
 * Inviting people onto teams (with a team role) and projects, through the Members page,
 * then accepting the invitation as the invited person in a separate browser.
 */
test.use({ storageState: ADMIN_STATE });

// Playwright applies this file's storageState to browser.newContext() too: invitees start signed out.
const SIGNED_OUT = { storageState: { cookies: [], origins: [] } };

const unique = (who: string) => `${who}+${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}@e2e.test`;

async function openInviteDialog(page: Page, orgId: string) {
  await page.goto(`/o/${orgId}/workers`);
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  await page.getByRole('button', { name: 'Invite member' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Invite member' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function pick(page: Page, field: 'Teams' | 'Projects', option: string) {
  await page.getByRole('button', { name: field }).click();
  await page.getByRole('option', { name: option }).getByRole('checkbox').check();
  await page.keyboard.press('Escape');
}

test('an invited Team Manager joins as manager of their team, with their projects', { tag: '@smoke' }, async ({ page, browser, data }) => {
  const email = unique('mia');
  const dialog = await openInviteDialog(page, data.orgId);
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Name').fill('Mia Manager');
  await dialog.getByLabel('Role').selectOption({ label: 'Team Manager' });
  await pick(page, 'Teams', data.teamName);
  // A Team Manager always manages the teams they join.
  const manages = dialog.getByRole('checkbox', { name: /Manages these teams/ });
  await expect(manages).toBeChecked();
  await expect(manages).toBeDisabled();
  await pick(page, 'Projects', data.projects.app.name);
  await dialog.getByRole('button', { name: 'Send invitation' }).click();

  // Email is not set up on the test server, so the dialog hands over the link instead.
  const ready = page.getByRole('dialog', { name: 'Invitation ready' });
  await expect(ready).toContainText(`Share this link with ${email} yourself.`);
  const link = await ready.getByLabel('Invitation link').inputValue();
  expect(link).toContain('/invite?token=');
  await test.info().attach('invitation-ready', { body: await page.screenshot(), contentType: 'image/png' });
  await ready.getByRole('button', { name: 'Done' }).click();

  // Mia accepts in her own browser.
  const mia = await browser.newContext(SIGNED_OUT);
  const miaPage = await mia.newPage();
  await miaPage.goto(link);
  await expect(miaPage.getByRole('heading', { level: 1, name: 'You have been invited' })).toBeVisible();
  await miaPage.getByLabel('Your name').fill('Mia Manager');
  await miaPage.getByLabel('Choose a password').fill(PASSWORD);
  await miaPage.getByRole('button', { name: 'Join organization' }).click();
  await expect(miaPage).toHaveURL(new RegExp(`/o/${data.orgId}`));
  // Managers stay on the web (only Workers are sent to the desktop app).
  await expect(miaPage.getByRole('complementary', { name: 'Primary' })).toBeVisible();

  // Her team shows her as its manager...
  await miaPage.goto(`/o/${data.orgId}/teams`);
  await expect(miaPage.getByRole('row', { name: new RegExp(data.teamName) })).toContainText('Mia Manager');
  // ...and the people on her team are in her scope (Wade is on it).
  await miaPage.goto(`/o/${data.orgId}/workers`);
  await expect(miaPage.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  await expect(miaPage.getByText(data.worker.name).first()).toBeVisible();
  // Her invited project is one she can track to.
  const assignments = await miaPage.request.get(`/api/v1/orgs/${data.orgId}/me/assignments`);
  expect((await assignments.json()).map((a: { project_name: string }) => a.project_name)).toContain(data.projects.app.name);
  await mia.close();
});

test('an invited Worker joins the team as a member and is sent to the desktop app', async ({ page, browser, data }) => {
  const email = unique('wes');
  const dialog = await openInviteDialog(page, data.orgId);
  await dialog.getByLabel('Email').fill(email);
  await expect(dialog.getByLabel('Role')).toHaveValue(/.+/);
  await pick(page, 'Teams', data.teamName);
  // For a Worker, managing the team is a choice, off by default.
  await expect(dialog.getByRole('checkbox', { name: /Manages these teams/ })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  const link = await page.getByRole('dialog', { name: 'Invitation ready' }).getByLabel('Invitation link').inputValue();

  const wes = await browser.newContext(SIGNED_OUT);
  const wesPage = await wes.newPage();
  await wesPage.goto(link);
  await wesPage.getByLabel('Your name').fill('Wes Worker');
  await wesPage.getByLabel('Choose a password').fill(PASSWORD);
  await wesPage.getByRole('button', { name: 'Join organization' }).click();
  await expect(wesPage).toHaveURL(/\/download\?welcome=1/);
  await expect(wesPage.getByText('Your account is ready.')).toBeVisible();
  await wes.close();

  // On the team as a member, not a manager.
  const teams = await (await page.request.get(`/api/v1/orgs/${data.orgId}/teams`)).json();
  const team = teams.find((t: { name: string }) => t.name === data.teamName);
  expect(team.members).toContainEqual(expect.objectContaining({ name: 'Wes Worker', role: 'MEMBER' }));
  await page.goto(`/o/${data.orgId}/teams`);
  await expect(page.getByRole('row', { name: new RegExp(data.teamName) })).not.toContainText('Wes Worker');
});

test('the invitation cannot be sent without an email address', async ({ page, data }) => {
  const dialog = await openInviteDialog(page, data.orgId);
  await expect(dialog.getByRole('button', { name: 'Send invitation' })).toBeDisabled();
  await dialog.getByLabel('Email').fill(unique('x'));
  await expect(dialog.getByRole('button', { name: 'Send invitation' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('an invitation link can only be used once', async ({ page, browser, data }) => {
  const dialog = await openInviteDialog(page, data.orgId);
  await dialog.getByLabel('Email').fill(unique('once'));
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  const link = await page.getByRole('dialog', { name: 'Invitation ready' }).getByLabel('Invitation link').inputValue();

  const first = await browser.newContext(SIGNED_OUT);
  const p1 = await first.newPage();
  await p1.goto(link);
  await p1.getByLabel('Your name').fill('Olive Once');
  await p1.getByLabel('Choose a password').fill(PASSWORD);
  await p1.getByRole('button', { name: 'Join organization' }).click();
  await expect(p1).toHaveURL(/\/download/);
  await first.close();

  const again = await browser.newContext(SIGNED_OUT);
  const p2 = await again.newPage();
  await p2.goto(link);
  await p2.getByLabel('Your name').fill('Olive Again');
  await p2.getByLabel('Choose a password').fill(PASSWORD);
  await p2.getByRole('button', { name: 'Join organization' }).click();
  await expect(p2.getByRole('alert').filter({ hasText: /./ })).toContainText('This invitation is invalid or has expired');
  await again.close();
});
