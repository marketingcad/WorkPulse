import { expect, ok, search, test, uid } from '../../../support/fixtures';
import { ADMIN_STATE } from '../../../support/env';

/**
 * Audit 28 Oct 2026, phase 4: form integrity. Dialogs save only what was changed and never overwrite
 * a change saved meanwhile, entry times are on the member's clock, archived records can still be
 * filtered on, an expense follows its client's currency, and replacing or rotating something is said
 * before it happens.
 */
test.describe('QA · Form integrity (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the entry editor names its time zone and refuses to overwrite a change saved meanwhile', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const day = '2025-06-04';
    const note = `Stale edit ${data.run}-${uid()}`;
    await ok(await api.post(orgApi('/manual-time'), { data: { project_id: data.projects.website.id, started_at: `${day}T10:00:00.000Z`, ended_at: `${day}T11:00:00.000Z`, note, reason: 'E2E stale edit' } }), 'entry');

    await page.goto(`/o/${data.orgId}/timesheets/all`);
    await page.getByLabel('From', { exact: true }).fill(day);
    await page.getByLabel('To', { exact: true }).fill(day);
    await search(page, 'Search time entries', note, '/time-entries');
    const row = page.getByRole('listitem').filter({ hasText: note });
    await row.getByRole('button', { name: 'Entry actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit time entry' });
    // Times are on the entry's clock, and the dialog says which (it said "your browser's timezone").
    await expect(dialog).toContainText('Times are in UTC');
    await expect(dialog.getByLabel('Start')).toHaveValue(`${day}T10:00`);

    // Meanwhile someone marks the entry non-billable.
    const [entry] = await ok<Array<{ id: string; revision: number }>>(await api.get(orgApi(`/time-entries?from=${day}&to=${day}&q=${encodeURIComponent(note)}`)), 'entry');
    await ok(await api.patch(orgApi(`/time-entries/${entry!.id}`), { data: { billable: false, revision: entry!.revision } }), 'billable off');

    await dialog.getByLabel('Note').fill(`${note} (edited)`);
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog.getByText(/changed after you opened it/)).toBeVisible();
    const [now] = await ok<Array<{ billable: boolean; note: string }>>(await api.get(orgApi(`/time-entries?from=${day}&to=${day}&q=${encodeURIComponent(note)}`)), 'entry');
    expect([now!.billable, now!.note]).toEqual([false, note]);
  });

  test('editing a project from the list keeps members added elsewhere meanwhile', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const name = `Access ${uid()}`;
    const project = await ok<{ id: string }>(await api.post(orgApi('/projects'), { data: { name, member_ids: [data.newcomer.membershipId] } }), 'project');
    await page.goto(`/o/${data.orgId}/projects`);
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit project' });
    // While the dialog is open, the worker is given access in Members & teams.
    await ok(await api.patch(orgApi(`/projects/${project.id}`), { data: { member_ids: [data.newcomer.membershipId, data.worker.membershipId] } }), 'add member');
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(`${name} renamed`);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(dialog).toBeHidden();
    const saved = await ok<{ name: string; member_ids: string[] }>(await api.get(orgApi(`/projects/${project.id}`)), 'project');
    expect(saved.name).toBe(`${name} renamed`);
    expect(saved.member_ids.sort()).toEqual([data.newcomer.membershipId, data.worker.membershipId].sort()); // the worker was dropped before
  });

  test('an archived project can still be chosen as a Time entries filter', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const name = `Retired ${uid()}`;
    const project = await ok<{ id: string }>(await api.post(orgApi('/projects'), { data: { name } }), 'project');
    expect((await api.post(orgApi(`/projects/${project.id}/archive`))).status()).toBe(204);
    await page.goto(`/o/${data.orgId}/timesheets/all`);
    await page.getByLabel('Project', { exact: true }).selectOption({ label: `${name} (archived)` });
    await expect(page.getByLabel('Project', { exact: true }).locator('option:checked')).toHaveText(`${name} (archived)`);
  });

  test('a new expense takes the currency of its project’s client', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const suffix = uid();
    const client = await ok<{ id: string }>(await api.post(orgApi('/clients'), { data: { name: `Euro ${suffix}`, currency: 'EUR' } }), 'client');
    const project = `Euro work ${suffix}`;
    await ok(await api.post(orgApi('/projects'), { data: { name: project, client_id: client.id } }), 'project');
    await page.goto(`/o/${data.orgId}/finance/expenses`);
    await page.getByRole('button', { name: /New expense/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New expense' });
    await expect(dialog.getByLabel('Currency')).toHaveValue('USD');
    await dialog.getByLabel('Project').selectOption({ label: `${project} (Euro ${suffix})` });
    await expect(dialog.getByLabel('Currency')).toHaveValue('EUR'); // stayed USD, and the expense never reached an invoice
  });

  test('setting a budget on a project that has one says it replaces it', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const name = `Budgeted ${uid()}`;
    const project = await ok<{ id: string }>(await api.post(orgApi('/projects'), { data: { name } }), 'project');
    await ok(await api.put(orgApi('/budgets'), { data: { subject_type: 'PROJECT', subject_id: project.id, kind: 'HOURS', amount: 3600 * 10 } }), 'budget');
    await page.goto(`/o/${data.orgId}/finance/budgets`);
    await page.getByRole('button', { name: 'Set budget' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Set budget' });
    await dialog.getByLabel('Project').selectOption({ label: name });
    await expect(dialog.getByRole('note')).toHaveText(`${name} already has a budget. Saving replaces it.`);
  });

  test('rotating a webhook signing secret is confirmed first, and cancelling keeps the old one', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const desc = `Rotate ${uid()}`;
    await ok(await api.post(orgApi('/webhooks'), { data: { url: 'https://example.com/workpulse-rotate', description: desc, events: ['*'] } }), 'endpoint');
    await page.goto(`/o/${data.orgId}/developer/webhooks`);
    const row = page.getByRole('row').filter({ hasText: desc });
    await row.getByRole('button').last().click();
    await page.getByRole('menuitem', { name: 'Rotate signing secret' }).click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Rotate signing secret?' }));
    await expect(confirm).toContainText('stops working straight away');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog', { name: 'New signing secret' })).toHaveCount(0);
  });

  test('a deleted invoice draft leaves the list straight away', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const client = await ok<{ id: string }>(await api.post(orgApi('/clients'), { data: { name: `Draft ${uid()}` } }), 'client');
    // Issued today: the list is newest first, so it is on the first page.
    const today = new Date().toISOString().slice(0, 10);
    const inv = await ok<{ id: string; number: string }>(
      await api.post(orgApi('/invoices'), { data: { client_id: client.id, period_start: today, period_end: today, issue_date: today, due_date: today, extra_lines: [{ description: 'Fee', quantity: 1, unit_price_minor: 1000 }] } }),
      'draft',
    );
    // Seen in the list first, so the list is cached.
    await page.goto(`/o/${data.orgId}/finance/invoices`);
    await expect(page.getByRole('row', { name: new RegExp(inv.number) })).toBeVisible();
    await page.goto(`/o/${data.orgId}/finance/invoices/${inv.id}`);
    await page.getByRole('button', { name: /Delete draft/ }).first().click();
    await page.getByRole('alertdialog').or(page.getByRole('dialog', { name: `Delete draft ${inv.number}?` })).getByRole('button', { name: 'Delete draft' }).click();
    await expect(page).toHaveURL(new RegExp(`/finance/invoices$`));
    await expect(page.getByRole('row', { name: new RegExp(inv.number) })).toHaveCount(0, { timeout: 3000 });
  });
});
