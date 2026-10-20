import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Organization time rules, in a fresh organization per test so the shared one is never changed:
 * time types with pay and bill multipliers, time entry locking, and missing-time reminders.
 * Creating the organization also covers `POST /me/organizations` (the organization switcher's
 * "New organization").
 */
test.use({ storageState: ADMIN_STATE });

async function newOrganization(adminApi: { api: import('@playwright/test').APIRequestContext }, name: string): Promise<string> {
  const r = await ok<{ organization_id: string }>(await adminApi.api.post('/api/v1/me/organizations', { data: { name, timezone: 'UTC', currency: 'USD' } }), 'new organization');
  return r.organization_id;
}

test('an admin adds a time type with a pay multiplier, then archives it', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
  const orgId = await newOrganization(adminApi, `Rules A ${data.run} ${uid()}`);
  await page.goto(`/o/${orgId}/settings/time`);
  await expect(page.getByRole('heading', { name: 'Time types' })).toBeVisible();

  await page.getByRole('button', { name: 'Add time type' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New time type' });
  const save = dialog.getByRole('button', { name: 'Add time type' });
  // Name and short name are required, and multipliers must be between 0 and 10.
  await expect(save).toBeDisabled();
  // "Name" (not "Short name"); the label also carries the required marker.
  await dialog.getByRole('textbox', { name: /^Name/ }).fill('Overtime');
  await dialog.getByLabel('Short name').fill('OT');
  await dialog.getByLabel('Pay rate multiplier').fill('11');
  await expect(dialog.getByText('A number from 0 to 10')).toBeVisible();
  await expect(save).toBeDisabled();
  await dialog.getByLabel('Pay rate multiplier').fill('1.5');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText('Time type added')).toBeVisible();

  const row = page.getByRole('row', { name: /Overtime/ });
  await expect(row).toContainText('1.5×');
  await expect(row).toContainText('1×');

  await page.getByRole('button', { name: 'Actions for Overtime' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByRole('button', { name: 'Archive' }).last().click();
  await expect(page.getByText('Overtime archived')).toBeVisible();
  await expect(page.getByRole('row', { name: /Overtime/ })).toHaveCount(0);
});

test('an admin locks old time and turns on missing-time reminders', async ({ page, data, adminApi }) => {
  const orgId = await newOrganization(adminApi, `Rules B ${data.run} ${uid()}`);
  await page.goto(`/o/${orgId}/settings/time`);
  await expect(page.getByRole('heading', { level: 1, name: 'Time & pay' })).toBeVisible();
  const saveButton = page.getByRole('button', { name: 'Save changes' });

  // Locking: whole days from 0 to 3650.
  await page.getByLabel('Lock time older than (days)').fill('5000');
  await expect(page.getByText('Whole days from 0 to 3650')).toBeVisible();
  await expect(saveButton).toBeDisabled();
  await page.getByLabel('Lock time older than (days)').fill('7');
  await page.getByLabel('Lock time before').fill('2026-01-01');

  // Reminders need a daily or weekly minimum to compare against.
  await page.getByRole('switch', { name: 'Remind members about missing time' }).click();
  await expect(page.getByText('Set a daily or weekly minimum for reminders.')).toBeVisible();
  await expect(saveButton).toBeDisabled();
  await page.getByLabel('Minimum hours per week').fill('30');
  await expect(page.getByText('Set a daily or weekly minimum for reminders.')).toHaveCount(0);
  await page.getByLabel('Check at').fill('17:30');

  await saveButton.click();
  await expect(page.getByText('Time & pay settings saved')).toBeVisible();

  // Saved on the server, not only in the form.
  await page.reload();
  await expect(page.getByLabel('Lock time older than (days)')).toHaveValue('7');
  await expect(page.getByLabel('Lock time before')).toHaveValue('2026-01-01');
  await expect(page.getByRole('switch', { name: 'Remind members about missing time' })).toBeChecked();
  await expect(page.getByLabel('Minimum hours per week')).toHaveValue('30');
  await expect(page.getByLabel('Check at')).toHaveValue('17:30');
});
