import { expect, ok, test, usd } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Invoices, payments and expenses are paged by the server: the list shows one page at a time with
 * the real total, search and tabs filter on the server, and the totals cover every matching record.
 * Each test makes 55 records (more than one 50-row page) under its own client or search term.
 */
test.use({ storageState: ADMIN_STATE });

const unique = (prefix: string, run: string) => `${prefix} ${run} ${Date.now() % 100000}`;

test('invoices page through, with totals and tab counts over every invoice', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  const name = unique('Paged Client', data.run);
  const client = await ok<{ id: string }>(await api.post(orgApi('/clients'), { data: { name } }), 'client');
  const numbers: string[] = [];
  for (let i = 0; i < 55; i++) {
    const inv = await ok<{ id: string; number: string }>(
      await api.post(orgApi('/invoices'), {
        data: { client_id: client.id, period_start: '2026-01-01', period_end: '2026-01-31', issue_date: '2026-02-01', due_date: '2099-01-01', group_by: 'project', tax_rate_bps: 0, include_expenses: false, notes: null, extra_lines: [{ description: `Item ${i}`, quantity: 1, unit_price_minor: 10000, tax_rate_bps: 0 }] },
      }),
      `invoice ${i}`,
    );
    numbers.push(inv.number);
  }
  // Five of them are sent, so they are open and count towards "Outstanding".
  for (const inv of (await ok<Array<{ id: string; number: string }>>(await api.get(orgApi(`/invoices?client_id=${client.id}`)), 'list')).slice(0, 5)) await ok(await api.post(orgApi(`/invoices/${inv.id}/send`), { data: {} }), 'send');

  await page.goto(`/o/${data.orgId}/finance/invoices?client=${client.id}`);
  await expect(page.getByText('Showing 1–50 of 55 results')).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Showing 51–55 of 55 results')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Invoices' }).getByRole('row')).toHaveCount(6);

  // Totals and tab counts cover all 55 invoices, not just the page on screen.
  await expect(page.getByText(usd(5 * 10000)).first()).toBeVisible();
  await expect(page.getByText('5 open')).toBeVisible();
  await expect(page.getByRole('button', { name: /^All\s*55$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Draft\s*50$/ })).toBeVisible();

  // The Draft tab and the search both filter on the server.
  await page.getByRole('button', { name: /^Draft/ }).click();
  await expect(page.getByText('Showing 1–50 of 50 results')).toBeVisible();
  await page.getByRole('button', { name: /^All/ }).click();
  await page.getByLabel('Search invoices').fill(numbers[0]!);
  await expect(page.getByText('Showing 1–1 of 1 result')).toBeVisible();
  await expect(page.getByRole('link', { name: numbers[0]! })).toBeVisible();

  await page.getByLabel('Search invoices').fill('no-such-invoice-xyz');
  await expect(page.getByText('No invoices match your search')).toBeVisible();
});

test('payments search on the server by reference', async ({ page, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  const ref = `PAGED-${data.run}-${Date.now() % 100000}`;
  for (let i = 0; i < 55; i++) await ok(await api.post(orgApi('/payments'), { data: { client_id: null, amount_minor: 1000, currency: 'USD', received_on: '2026-03-01', provider: 'manual', provider_ref: `${ref}-${String(i).padStart(2, '0')}`, note: null, allocations: [] } }), `payment ${i}`);

  await page.goto(`/o/${data.orgId}/finance/invoices/payments`);
  await page.getByLabel('Search payments').fill(ref);
  await expect(page.getByText('Showing 1–50 of 55 results')).toBeVisible();
  await page.getByLabel('Search payments').fill(`${ref}-07`);
  await expect(page.getByText('Showing 1–1 of 1 result')).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`${ref}-07`) })).toBeVisible();
});

test('expenses page through, with tab counts and a total over every match', async ({ page, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  const tag = unique('Paged trip', data.run);
  for (let i = 0; i < 55; i++) await ok(await api.post(orgApi('/expenses'), { data: { category: 'Travel', description: `${tag} #${i}`, amount_minor: 1000, currency: 'USD', spent_on: '2026-03-02' } }), `expense ${i}`);

  await page.goto(`/o/${data.orgId}/finance/expenses`);
  await page.getByLabel('Search expenses').fill(tag);
  await expect(page.getByText('Showing 1–50 of 55 results')).toBeVisible();
  // The total covers all 55 matching expenses (55 × 10.00), not the 50 on this page.
  await expect(page.getByText(`Total (USD): ${usd(55 * 1000)}`)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Submitted\s*55$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Approved\s*0$/ })).toBeVisible();

  await page.getByRole('button', { name: /^Approved/ }).click();
  // Nothing approved matches the search.
  await expect(page.getByText('No expenses match your search')).toBeVisible();
});
