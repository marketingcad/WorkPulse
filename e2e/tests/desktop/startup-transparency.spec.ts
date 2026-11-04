import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '../../support/fixtures';

/**
 * UX audit, phase 1 (desktop): starting without a connection explains itself instead of spinning
 * forever (C1), and the worker sees what WorkPulse records (C3), as the browser sign-in promises.
 */
test.describe('Desktop start-up and tracking transparency', () => {
  test('starting offline says why, what to do, and can try again', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice }) => {
    const handle = await openDesktop(workerDevice, {
      state: (r) => ({ ...r, account: null, policy: null, assignments: [], sync: { ...r.sync, online: false }, connectError: 'Can’t reach WorkPulse. Check your internet connection and try again.' }),
      record: ['reconnect'],
    });
    const alert = page.getByRole('alert');
    await expect(alert.getByRole('heading', { name: 'Can’t connect to WorkPulse' })).toBeVisible();
    await expect(alert).toContainText('Check your internet connection');
    await expect(alert).toContainText('keeps trying on its own');
    // No raw codes reach the worker.
    await expect(page.getByText(/net::ERR_/)).toHaveCount(0);
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => handle.calls.map((c) => c.op)).toContain('reconnect');
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  });

  test('while the account loads, it says it is connecting (no bare spinner)', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice, { state: (r) => ({ ...r, account: null, policy: null, assignments: [] }) });
    await expect(page.getByRole('status')).toHaveText('Connecting to WorkPulse…');
  });

  test('Home shows what is recorded, from the organization policy', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice, {
      state: (r) => ({
        ...r,
        policy: { ...r.policy!, screenshots: { ...r.policy!.screenshots, enabled: true, perTenMinutes: 2, blur: true, notify: true }, apps: { enabled: false } },
        capabilities: { input: true, screenshots: true, apps: true, urls: true },
      }),
    });
    const card = page.getByRole('region', { name: 'What WorkPulse records' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Only while you are clocked in');
    await expect(card).toContainText('What you type is never recorded');
    await expect(card.getByRole('listitem').filter({ hasText: 'Screenshots' })).toContainText('2 every 10 minutes, of every screen, blurred');
    await expect(card.getByRole('listitem').filter({ hasText: 'Apps' })).toContainText('Apps: not recorded.');
    expect((await new AxeBuilder({ page }).include('[aria-labelledby="disclosure-title"]').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  });

  test('Settings repeats it, and says when this computer cannot record something', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice, { state: (r) => ({ ...r, policy: { ...r.policy!, apps: { enabled: true } }, capabilities: { input: true, screenshots: true, apps: false, urls: true } }) });
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Settings', exact: true }).click();
    const card = page.getByRole('region', { name: 'What WorkPulse records' });
    await expect(card.getByRole('listitem').filter({ hasText: 'Apps' })).toContainText('This computer does not allow it');
    // Sign out stays reachable below the card.
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});
