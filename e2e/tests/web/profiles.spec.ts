import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';

/**
 * Profiles: client details (contact, document language, rates, logo), project details (dates,
 * estimate) and project documents, and staff personal info with HR notes that only admins see.
 */

/** A 1×1 PNG, enough for the logo editor. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const unique = (prefix: string, run: string) => `${prefix} ${run} ${Date.now() % 100000}`;

test.describe('Client profiles', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin creates a client with contact details, document language, rates and a logo', { tag: '@smoke' }, async ({ page, data }) => {
    const name = unique('Umbrella', data.run);
    await page.goto(`/o/${data.orgId}/clients`);
    await page.getByRole('button', { name: 'New client' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New client' });

    await dialog.getByLabel('Company / client name').fill(name);
    await dialog.getByLabel('Contact person').fill('Alice Rivera');
    await dialog.getByLabel('Contact email').fill('billing@umbrella.test');
    await dialog.getByLabel('Phone number').fill('+1 555 0100');
    await dialog.getByLabel('Document language').selectOption({ label: 'Deutsch' });
    await dialog.getByLabel('Pay rate per hour').fill('60');
    await dialog.getByLabel('Bill rate per hour').fill('120');
    await dialog.locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await expect(dialog.getByRole('button', { name: 'Change logo' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByText('Client created')).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toContainText('billing@umbrella.test');

    // Everything was saved: reopen it.
    await row.click();
    const edit = page.getByRole('dialog', { name: 'Edit client' });
    await expect(edit.getByLabel('Contact person')).toHaveValue('Alice Rivera');
    await expect(edit.getByLabel('Document language')).toHaveValue('de');
    await expect(edit.getByLabel('Bill rate per hour')).toHaveValue('120.00');
    await expect(edit.getByLabel('Pay rate per hour')).toHaveValue('60.00');
    await expect(edit.getByRole('button', { name: 'Change logo' })).toBeVisible();
  });

  test('a client needs a name, and its logo must be an image', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/clients`);
    await page.getByRole('button', { name: 'New client' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New client' });
    await expect(dialog.getByRole('button', { name: 'Create client' })).toBeDisabled();

    await dialog.locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('not really an image') });
    await expect(dialog.getByText('That image could not be read')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Upload logo' })).toBeVisible();
  });
});

test.describe('Project details and documents', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin sets a project’s dates and estimate', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const project = await ok<{ id: string; name: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: unique('Rebrand', data.run), member_ids: [data.admin.membershipId] } }), 'project');
    await page.goto(`/o/${data.orgId}/projects/${project.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(project.name);

    // The project's tabs are a group of buttons ("Settings" is also a sidebar group).
    const tabs = page.getByRole('group', { name: 'Sections' });
    await tabs.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Start date').fill('2026-11-02');
    await page.getByLabel('End date').fill('2026-12-18');
    await page.getByLabel('Estimated hours').fill('80');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Project saved')).toBeVisible();

    await page.reload();
    await tabs.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Start date')).toHaveValue('2026-11-02');
    await expect(page.getByLabel('End date')).toHaveValue('2026-12-18');
    await expect(page.getByLabel('Estimated hours')).toHaveValue('80');
    await expect(page.getByText('Estimated time')).toBeVisible();
    await expect(page.getByText('80h 00m').first()).toBeVisible();
  });

  test('an admin uploads a project document, and unsafe files are refused', async ({ page, data, adminApi }) => {
    const project = await ok<{ id: string; name: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: unique('Docs', data.run), member_ids: [data.admin.membershipId] } }), 'project');
    await page.goto(`/o/${data.orgId}/projects/${project.id}`);
    await page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Documents', exact: true }).click();
    await expect(page.getByText('No documents yet')).toBeVisible();

    const files = page.locator('input[type=file]');
    await files.setInputFiles({ name: 'brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%E2E brief\n') });
    await expect(page.getByText('brief.pdf uploaded')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download brief.pdf' })).toBeVisible();

    await files.setInputFiles({ name: 'setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
    await expect(page.getByText(/^setup\.exe: /)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download setup.exe' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Delete brief.pdf' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('brief.pdf deleted')).toBeVisible();
    await expect(page.getByText('No documents yet')).toBeVisible();
  });
});

test.describe('Staff profiles', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin fills in personal info with an HR note that the member never sees', { tag: '@smoke' }, async ({ page, browser, data }) => {
    const note = `Probation review in March (${data.run})`;
    await page.goto(`/o/${data.orgId}/workers/${data.viewer.membershipId}`);
    await page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Personal info', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('City').fill('Lisbon');
    await page.getByLabel('HR notes').fill(note);
    await page.getByRole('button', { name: 'Save personal info' }).click();
    await expect(page.getByText('Personal info saved')).toBeVisible();
    await expect(page.getByText(note)).toBeVisible();

    // Vera opens her own profile: she sees her details, but not the HR notes field or its text.
    const vera = await browser.newContext({ storageState: VIEWER_STATE });
    const own = await vera.newPage();
    await own.goto(`/o/${data.orgId}/workers/${data.viewer.membershipId}`);
    await own.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Personal info', exact: true }).click();
    await expect(own.getByText('Lisbon')).toBeVisible();
    await expect(own.getByText('HR notes')).toHaveCount(0);
    await expect(own.getByText(note)).toHaveCount(0);
    await vera.close();
  });
});

test.describe('Profiles (no access)', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone without client access cannot open the clients page', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/clients`);
    await expect(page.getByText('Restricted')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New client' })).toHaveCount(0);
  });
});
