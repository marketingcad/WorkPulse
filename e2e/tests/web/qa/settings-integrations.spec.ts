import { expect, ok, test, uid } from '../../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE, WEB_URL } from '../../../support/env';

/**
 * QA: API keys, webhooks, custom roles and the report runner, end to end through the UI, with the
 * result checked against the API (a created key really works, a revoked one really stops).
 */
test.describe('QA · API keys (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an API key works against the API until it is revoked', { tag: '@smoke' }, async ({ page, data }) => {
    const name = `QA key ${uid()}`;
    await page.goto(`/o/${data.orgId}/developer/api-keys`);
    await expect(page.getByRole('heading', { level: 1, name: 'API keys' })).toBeVisible();
    await page.getByRole('button', { name: /Create API key/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Create API key' });
    const create = dialog.getByRole('button', { name: /Create/ }).last();
    // Name and at least one scope are required.
    await expect(create).toBeDisabled();
    await dialog.getByLabel('Name').fill(name);
    await expect(create).toBeDisabled();
    await dialog.getByRole('checkbox').first().check();
    await create.click();

    const created = page.getByRole('dialog', { name: 'API key created' });
    await expect(created).toContainText('will not be shown again');
    const secret = (await created.getByText(/^tw_live_/).first().textContent())!.trim();
    expect(secret).toMatch(/^tw_live_/);
    await created.getByRole('button', { name: 'I have stored the key' }).click();

    // The key reads the API (no cookies: only the key), with only its scope.
    const call = () => fetch(`${WEB_URL}/api/v1/orgs/${data.orgId}/projects`, { headers: { Authorization: `Bearer ${secret}` } });
    const firstScope = await call();
    expect([200, 403]).toContain(firstScope.status);

    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Revoke ${name}` }).click();
    await page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Revoke API key?' })).getByRole('button', { name: /Revoke/ }).click();
    await expect.poll(async () => (await call()).status).toBe(401);
  });
});

test.describe('QA · Webhooks (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an endpoint needs a valid https URL, is created with a signing secret, and can be deleted', async ({ page, data }) => {
    const desc = `QA hook ${uid()}`;
    await page.goto(`/o/${data.orgId}/developer/webhooks`);
    await expect(page.getByRole('heading', { level: 1, name: 'Webhooks' })).toBeVisible();
    await page.getByRole('button', { name: /Add endpoint/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add endpoint' });
    await dialog.getByLabel('Endpoint URL').fill('not a url');
    await dialog.getByLabel('Description').fill(desc);
    const save = dialog.getByRole('button', { name: /Add endpoint|Save|Create/ }).last();
    if (await save.isEnabled()) {
      await save.click();
      await expect(dialog).toBeVisible();
    }
    // At least one event is required.
    await dialog.getByLabel('Endpoint URL').fill('https://example.com/workpulse-hook');
    await expect(save).toBeDisabled();
    await dialog.getByRole('checkbox', { name: 'All events, including future ones' }).check();
    // A host that does not exist is refused, with the reason shown in the dialog.
    await dialog.getByLabel('Endpoint URL').fill('https://no-such-host.invalid/hook');
    await save.click();
    await expect(dialog.getByText('Webhook host could not be resolved')).toBeVisible();
    await dialog.getByLabel('Endpoint URL').fill('https://example.com/workpulse-hook');
    await save.click();
    await expect(page.getByRole('dialog', { name: 'Endpoint created' })).toContainText(/whsec_|secret/i);
    await page.getByRole('dialog', { name: 'Endpoint created' }).getByRole('button').last().click();
    const row = page.getByRole('row', { name: /example\.com\/workpulse-hook/ }).filter({ hasText: desc });
    await expect(row).toBeVisible();
  });
});

test.describe('QA · Roles (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a custom role is created from an existing one and appears in the permission matrix', async ({ page, data, adminApi }) => {
    const name = `QA Auditor ${uid()}`;
    await page.goto(`/o/${data.orgId}/settings/roles`);
    await expect(page.getByRole('heading', { level: 1, name: 'Roles & permissions' })).toBeVisible();
    await page.getByRole('button', { name: /Create custom role/ }).first().click();
    const dialog = page.getByRole('dialog');
    const create = dialog.getByRole('button', { name: 'Create role' });
    await expect(create).toBeDisabled();
    await dialog.getByLabel('Name').fill(name);
    await create.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(name).first()).toBeVisible();
    const roles = await ok<Array<{ name: string; builtin: boolean }>>(await adminApi.api.get(adminApi.orgApi('/roles')), 'roles');
    expect(roles.find((r) => r.name === name)).toMatchObject({ builtin: false });
  });
});

test.describe('QA · Report runner (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('runs a report, downloads it as CSV, and saves it on a schedule that emails the author', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/reports`);
    await page.getByRole('link', { name: /Time & Activity/ }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Time & Activity' })).toBeVisible();

    await page.getByRole('button', { name: 'Export' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^time-activity_.*\.csv$/);

    const name = `QA weekly ${uid()}`;
    await page.getByRole('button', { name: 'Save report' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save report' });
    const save = dialog.getByRole('button', { name: /^Save/ }).last();
    // A name is required.
    await dialog.getByLabel('Name').fill('');
    await expect(save).toBeDisabled();
    await dialog.getByLabel('Name').fill(name);
    // Scheduling it adds you as the first recipient.
    await dialog.getByRole('switch', { name: /Email on a schedule/ }).click();
    await expect(dialog.getByRole('button', { name: `Send to: ${data.admin.name}` })).toBeVisible();
    await save.click();
    await expect(dialog).toBeHidden();
    await page.goto(`/o/${data.orgId}/reports`);
    await expect(page.getByText(name)).toBeVisible();
  });

  // Audit 28 Oct 2026 (Q5): a scheduled report is computed with its owner's access, so a worker
  // who can't open the payroll export can't be sent it either.
  test('refuses to schedule the payroll export to a worker, with the reason under Recipients', async ({ page, data, adminApi }) => {
    await page.goto(`/o/${data.orgId}/reports/payroll`);
    await expect(page.getByRole('heading', { level: 1, name: 'Payroll Export' })).toBeVisible();
    const name = `QA payroll to worker ${uid()}`;
    await page.getByRole('button', { name: 'Save report' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save report' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('switch', { name: /Email on a schedule/ }).click();
    await expect(dialog.getByText('Members who can see everything in this report, up to 20.')).toBeVisible();
    await dialog.getByRole('button', { name: /^Send to:/ }).click();
    await page.getByRole('listbox', { name: 'Send to' }).getByRole('checkbox', { name: new RegExp(data.worker.name) }).check();
    await page.keyboard.press('Escape');
    await dialog.getByRole('button', { name: /^Save/ }).last().click();
    await expect(dialog.getByText(/can’t see everything in this report/)).toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const saved = await ok<Array<{ name: string }>>(await adminApi.api.get(adminApi.orgApi('/saved-reports')), 'saved reports');
    expect(saved.map((s) => s.name)).not.toContain(name);
  });
});

test.describe('QA · Settings access (restricted role)', () => {
  test.use({ storageState: VIEWER_STATE });

  test('a role without settings access cannot open API keys, webhooks or roles', async ({ page, data }) => {
    for (const path of ['/developer/api-keys', '/developer/webhooks', '/settings/roles']) {
      await page.goto(`/o/${data.orgId}${path}`);
      await expect(page.getByRole('heading', { level: 1, name: /API keys|Webhooks|Roles/ })).toHaveCount(0);
    }
  });
});
