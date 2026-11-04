import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';

/**
 * Personal data export (access request): an admin downloads a copy of a member's data from their
 * profile; a member downloads their own. The copy is written for people, not developers.
 */

test.describe('Personal data export', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin exports a member’s data and gets a download', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/workers/${data.viewer.membershipId}`);
    const panel = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Personal data' }) }).last();
    await expect(panel.getByText('download a copy of all of it to send them')).toBeVisible();
    await expect(panel.getByText(/JSON/)).toHaveCount(0);

    await panel.getByRole('button', { name: 'Export their data' }).click();
    await expect(page.getByText('Export started')).toBeVisible();
    await expect(panel.getByText('Ready')).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByRole('link', { name: 'Download file' })).toBeVisible();
    await expect(panel.getByText(/Supabase|mime|could not be created/i)).toHaveCount(0);
  });
});

test.describe('Personal data export (member)', () => {
  test.use({ storageState: VIEWER_STATE });

  test('a member exports their own data, but cannot export or erase anyone else’s', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/me/profile`);
    await expect(page.getByText(/JSON/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Export my data' }).click();
    await expect(page.getByRole('link', { name: 'Download file' })).toBeVisible({ timeout: 30_000 });

    await page.goto(`/o/${data.orgId}/workers/${data.worker.membershipId}`);
    // Another member's profile is not found for her, so neither action is offered.
    await expect(page.getByText('worker not found')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export their data' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Erase' })).toHaveCount(0);
  });
});
