import { expect, ok, test, usd } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';

/**
 * Budgets: set, edit and delete a project budget in the dialog, its validation, and the rule that
 * money budget amounts are hidden from people who may see budgets but not money.
 */
test.describe('Budgets (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin sets an hours budget, switches it to money, then deletes it', { tag: '@smoke' }, async ({ page, data }) => {
    const project = data.projects.app.name;
    await page.goto(`/o/${data.orgId}/finance/budgets`);
    await expect(page.getByRole('heading', { level: 1, name: 'Budgets' })).toBeVisible();

    // The empty state has its own "Set budget" button, so take the page header's (the first).
    await page.getByRole('button', { name: 'Set budget' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Set budget' });
    await dialog.getByLabel('Project').selectOption({ label: project });
    await dialog.getByLabel('Hours').fill('120');
    await dialog.getByRole('button', { name: 'Save budget' }).click();
    await expect(page.getByText('Budget saved')).toBeVisible();
    await expect(dialog).toBeHidden();

    const row = page.getByRole('row', { name: new RegExp(project) });
    await expect(row).toContainText('Hours');

    await page.getByRole('button', { name: `Edit budget for ${project}` }).click();
    const edit = page.getByRole('dialog', { name: `Edit budget · ${project}` });
    // The subject is fixed once a budget exists.
    await expect(edit.getByLabel('Project')).toBeDisabled();
    await edit.getByLabel('Type').selectOption({ label: 'Money (bill amount)' });
    await edit.getByLabel('Amount (USD)').fill('5000');
    await edit.getByRole('button', { name: 'Save budget' }).click();
    await expect(edit).toBeHidden();
    await expect(row).toContainText('Money (billed)');
    await expect(row).toContainText(usd(500000));

    await page.getByRole('button', { name: `Delete budget for ${project}` }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete budget?' }).or(page.getByRole('dialog', { name: 'Delete budget?' }));
    await confirm.getByRole('button', { name: 'Delete budget' }).click();
    await expect(page.getByText('Budget deleted')).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(project) })).toHaveCount(0);
  });

  test('the budget dialog asks for an amount and a subject before saving', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/finance/budgets`);
    await page.getByRole('button', { name: 'Set budget' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Set budget' });

    await dialog.getByRole('button', { name: 'Save budget' }).click();
    await expect(dialog.getByText('Enter a number of hours, e.g. 120 or 37.5')).toBeVisible();

    await dialog.getByLabel('Hours').fill('-3');
    await dialog.getByRole('button', { name: 'Save budget' }).click();
    await expect(dialog.getByText('Enter a number of hours, e.g. 120 or 37.5')).toBeVisible();

    await dialog.getByLabel('Hours').fill('40');
    await dialog.getByRole('button', { name: 'Save budget' }).click();
    await expect(dialog.getByText('Choose a project')).toBeVisible();

    // Nothing was saved: cancelling leaves the dialog without a toast.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Budget saved')).toHaveCount(0);
  });
});

test.describe('Budgets (no money access)', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone who may see budgets but not money sees usage without amounts, and cannot edit', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const project = data.projects.website;
    await ok(await api.put(orgApi('/budgets'), { data: { subject_type: 'PROJECT', subject_id: project.id, kind: 'MONEY', amount: 123400, period: 'TOTAL', warn_pct: 80, include_non_billable: false } }), 'money budget');

    await page.goto(`/o/${data.orgId}/finance/budgets`);
    const row = page.getByRole('row', { name: new RegExp(project.name) });
    await expect(row).toContainText('Money (billed)');
    await expect(row).toContainText('—');
    await expect(row).not.toContainText(usd(123400));
    await expect(page.getByText(usd(123400))).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Set budget' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Edit budget for ${project.name}` })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Delete budget for ${project.name}` })).toHaveCount(0);
  });
});
