import type { Page } from '@playwright/test';
import { expect, test, usd } from '../../support/fixtures';
import { WEB_URL } from '../../support/env';

/** Reach Pay Stubs through its own sidebar item. */
const openPayStubs = async (page: Page) => {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Pay stubs', exact: true }).click();
};

/**
 * Pay stubs in the desktop app (workers use the desktop app only, so this is how they get their pay).
 * Data: global-setup finalizes a weekly payroll for Wade (3 h at $25 + $50 bonus − $10 equipment).
 */
const longDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

test.describe('Pay Stubs page', () => {
  test('a worker sees their finalized pay stub with hours, gross, adjustments and net pay', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice, data }) => {
    await openDesktop(workerDevice);
    await openPayStubs(page);

    await expect(page.getByRole('heading', { level: 1, name: 'Pay Stubs' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Pay stubs', exact: true })).toHaveAttribute('aria-current', 'page');
    const row = page.getByRole('listitem').filter({ hasText: `${longDay(data.payStub.periodStart)} – ${longDay(data.payStub.periodEnd)}` });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('3h 00m');
    await expect(row).toContainText(`Gross ${usd(data.payStub.grossMinor)}`);
    await expect(row).toContainText(`Adjustments +${usd(4000)}`);
    await expect(row).toContainText(usd(data.payStub.netMinor));
    await expect(row).toContainText('Net pay');
    await expect(row).toContainText('Finalized');
    expect(data.payStub).toMatchObject({ grossMinor: 7500, netMinor: 11500 });
    await test.info().attach('pay-stubs', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('downloads the pay stub as a real PDF', { tag: '@smoke' }, async ({ page, openDesktop, workerDevice, data }) => {
    const desktop = await openDesktop(workerDevice);
    await openPayStubs(page);
    await page.getByRole('button', { name: 'PDF' }).click();

    await expect.poll(() => desktop.savedPdfs.length).toBe(1);
    expect(desktop.savedPdfs[0]!.id).toBe(data.payStub.id);
    expect(desktop.savedPdfs[0]!.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    // The button is usable again and no error is shown.
    await expect(page.getByRole('button', { name: 'PDF' })).toBeEnabled();
    await expect(page.getByText('Could not download the pay stub')).toHaveCount(0);
  });

  test('a worker who is in no finalized payroll sees the empty state', async ({ page, openDesktop, newcomerDevice }) => {
    await openDesktop(newcomerDevice);
    await openPayStubs(page);
    await expect(page.getByText('No pay stubs yet. They appear here when a payroll that includes you is finalized.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'PDF' })).toHaveCount(0);
  });

  test('shows the error when pay stubs cannot be loaded', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice, { offline: ['pay-stubs'] });
    await openPayStubs(page);
    await expect(page.getByText('Could not reach the server. Check your connection.')).toBeVisible();
    // The standardized error state offers a way to retry.
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('the "pay stub ready" notification opens the Pay Stubs page', async ({ page, openDesktop, workerDevice }) => {
    await openDesktop(workerDevice);
    await expect(page.getByRole('heading', { level: 1, name: 'Pay Stubs' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.getByRole('button', { name: /Your pay stub is ready/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pay Stubs' })).toBeVisible();
  });
});

test.describe('Pay stub access', () => {
  test('a device can never open another person’s pay stub', async ({ request, newcomerDevice, data }) => {
    const pdf = (token: string, id: string) => request.get(`${WEB_URL}/api/v1/agent/me/pay-stubs/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    // Nina's device asking for Wade's stub: not found, not forbidden (no hint that it exists).
    expect((await pdf(newcomerDevice.token, data.payStub.id)).status()).toBe(404);
    // Without a device token there is no access at all.
    expect((await request.get(`${WEB_URL}/api/v1/agent/me/pay-stubs`)).status()).toBe(401);
  });
});
