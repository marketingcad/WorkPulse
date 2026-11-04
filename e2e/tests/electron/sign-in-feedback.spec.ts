import { expect, test } from '../../support/electron';

/**
 * QA (audit of 30 Oct 2026, VF-13): the real desktop app's sign-in tells the person what is wrong
 * when the main process refuses the input, instead of doing nothing.
 */
test('VF-13: a mistyped email on desktop sign-in is explained, not ignored', async ({ desktopApp }) => {
  const { window } = desktopApp;
  await expect(window.getByRole('heading', { level: 1, name: 'Welcome Back' })).toBeVisible();
  await window.getByLabel('Email').fill('worker@');
  await window.getByLabel('Password', { exact: true }).fill('not the password');
  await window.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(window.getByRole('alert')).toBeVisible();
  await expect(window.getByRole('alert')).not.toContainText('Invalid payload');
});
