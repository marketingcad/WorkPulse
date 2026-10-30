import { expect, test } from '../kit';

// 16.2 (the end card) is made in the editor; it has no recording.

test('16.1', async ({ d, page }) => {
  await d.go('');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  d.begin();
  await d.mark('slow push-in on the Overview');
  await d.point(page.getByText('Waiting for approval', { exact: true }), { hold: 3000 });
  await d.point(page.getByText('Project budgets', { exact: true }), { hold: 3000 });
  const invoices = page.getByText('Invoices', { exact: true }).last();
  if (await invoices.isVisible()) await d.point(invoices, { hold: 3000 });
  await d.finish();
});
