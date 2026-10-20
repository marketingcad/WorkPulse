import { expect, ok, test, usd, uid } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';

/**
 * Invoices and the payments received against them, which live under one "Invoices" menu item:
 * build a draft from a custom line, send it, record the payment, and find it under
 * "Payments received". Plus the composer's checks, and who must not see invoices at all.
 */
test.describe('Invoices (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin invoices a client, sends it and records the payment', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const client = `Acme ${data.run} ${test.info().workerIndex}${Date.now() % 1000}`;
    await ok(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: client } }), 'client');

    await page.goto(`/o/${data.orgId}/finance/invoices`);
    await expect(page.getByRole('heading', { level: 1, name: 'Invoices' })).toBeVisible();
    await page.getByRole('button', { name: 'New invoice' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'New invoice' })).toBeVisible();

    // Step 1: client and period.
    await page.getByLabel('Client').selectOption({ label: client });
    await page.getByRole('button', { name: 'Preview lines' }).click();

    // Step 2: nothing tracked to bill, so add a fixed fee.
    await expect(page.getByText('Nothing to invoice in this period')).toBeVisible();
    await page.getByRole('button', { name: 'Add line' }).click();
    await page.getByLabel('Description').fill('Design retainer');
    await page.getByLabel('Unit price (USD)').fill('1500');
    await expect(page.getByRole('table', { name: 'Invoice lines' })).toContainText('Design retainer');
    await page.getByRole('button', { name: 'Dates & notes', exact: true }).click();

    // Step 3 and review.
    await page.getByLabel('Notes').fill('Thank you for your business.');
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(page.getByText(usd(150000)).first()).toBeVisible();
    await page.getByRole('button', { name: 'Create draft invoice' }).click();

    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/finance/invoices/[0-9a-f-]{36}$`));
    const header = page.getByRole('heading', { level: 1 });
    await expect(header).toContainText('Draft');
    const number = ((await header.textContent()) ?? '').replace('Draft', '').trim();
    expect(number).toMatch(/\w/);
    // No payment can be recorded on a draft.
    await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);

    // The client has no email address, so "Send" marks it as sent.
    await page.getByRole('button', { name: 'Send' }).click();
    await page.getByRole('button', { name: 'Mark as sent' }).click();
    await expect(page.getByText('Invoice marked as sent (client has no email address)')).toBeVisible();
    await expect(header).toContainText('Sent');

    await page.getByRole('button', { name: 'Record payment' }).click();
    const pay = page.getByRole('dialog', { name: 'Record payment' });
    // The whole balance is suggested.
    await expect(pay.getByLabel('Amount (USD)')).toHaveValue('1500.00');
    await pay.getByLabel('Reference').fill(`TX-${data.run}`);
    await pay.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByText('Payment recorded')).toBeVisible();
    await expect(header).toContainText('Paid');
    await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);

    // Payments live in the same menu item, on the "Payments received" tab.
    await page.goto(`/o/${data.orgId}/finance/invoices`);
    // The section tabs are links to each page (the sidebar's Invoices item carries both).
    await page.getByRole('navigation', { name: 'Invoices' }).getByRole('link', { name: 'Payments received' }).click();
    await expect(page).toHaveURL(/\/finance\/invoices\/payments/);
    await expect(page.getByRole('heading', { level: 1, name: 'Payments received' })).toBeVisible();
    const payment = page.getByRole('row', { name: new RegExp(client) });
    await expect(payment).toContainText(`TX-${data.run}`);
    await expect(payment).toContainText(usd(150000));
    await expect(payment).toContainText(number);
  });

  test('the invoice composer checks the client, tax rate, lines and dates', async ({ page, data, adminApi }) => {
    const client = `Globex ${data.run} ${uid()}`;
    await ok(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: client } }), 'client');
    await page.goto(`/o/${data.orgId}/finance/invoices/new`);

    // The step indicator also has a button per step ("3 Dates & notes"), so action buttons are matched exactly.
    const next = page.getByRole('button', { name: 'Preview lines' });
    await expect(next).toBeDisabled();
    await page.getByLabel('Client').selectOption({ label: client });
    await expect(next).toBeEnabled();

    await page.getByLabel('Tax rate (%)').fill('150');
    await expect(page.getByText('Enter a percentage between 0 and 100.')).toBeVisible();
    await expect(next).toBeDisabled();
    await page.getByLabel('Tax rate (%)').fill('10');
    await next.click();

    // With nothing to invoice and no custom line, there is nothing to continue with.
    await expect(page.getByText('Nothing to invoice in this period')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dates & notes', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Add line' }).click();
    await page.getByLabel('Unit price (USD)').fill('200');
    // A line needs a description.
    await expect(page.getByRole('button', { name: 'Dates & notes', exact: true })).toBeDisabled();
    await page.getByLabel('Description').fill('Setup fee');
    await expect(page.getByRole('button', { name: 'Dates & notes', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Dates & notes', exact: true }).click();

    await page.getByLabel('Issue date').fill('2026-03-10');
    await page.getByLabel('Due date').fill('2026-03-01');
    await expect(page.getByText('The due date must be on or after the issue date.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review', exact: true })).toBeDisabled();
  });

  test('recording a payment needs an amount', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const c = await ok<{ id: string }>(await api.post(orgApi('/clients'), { data: { name: `Initech ${data.run} ${uid()}` } }), 'client');
    const inv = await ok<{ id: string }>(
      await api.post(orgApi('/invoices'), {
        data: { client_id: c.id, period_start: '2026-01-01', period_end: '2026-01-31', issue_date: '2026-02-01', due_date: '2026-03-01', group_by: 'project', tax_rate_bps: 0, include_expenses: false, notes: null, extra_lines: [{ description: 'Audit', quantity: 1, unit_price_minor: 30000, tax_rate_bps: 0 }] },
      }),
      'invoice',
    );
    await ok(await api.post(orgApi(`/invoices/${inv.id}/send`), { data: {} }), 'send invoice');

    await page.goto(`/o/${data.orgId}/finance/invoices/${inv.id}`);
    await page.getByRole('button', { name: 'Record payment' }).click();
    const pay = page.getByRole('dialog', { name: 'Record payment' });
    await pay.getByLabel('Amount (USD)').fill('');
    await pay.getByRole('button', { name: 'Record payment' }).click();
    await expect(pay.getByText('Enter an amount greater than zero')).toBeVisible();
    await expect(page.getByText('Payment recorded')).toHaveCount(0);
  });
});

test.describe('Payments across open invoices (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a payment is split over the client’s open invoices, and paid or draft ones are not offered', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const c = await ok<{ id: string; name: string }>(await api.post(orgApi('/clients'), { data: { name: `Wayne ${data.run} ${uid()}` } }), 'client');
    const make = async (amount: number, send: boolean) => {
      const inv = await ok<{ id: string; number: string }>(
        await api.post(orgApi('/invoices'), {
          data: { client_id: c.id, period_start: '2026-01-01', period_end: '2026-01-31', issue_date: '2026-02-01', due_date: '2099-01-01', group_by: 'project', tax_rate_bps: 0, include_expenses: false, notes: null, extra_lines: [{ description: 'Work', quantity: 1, unit_price_minor: amount, tax_rate_bps: 0 }] },
        }),
        'invoice',
      );
      if (send) await ok(await api.post(orgApi(`/invoices/${inv.id}/send`), { data: {} }), 'send');
      return inv;
    };
    const first = await make(10000, true);
    const second = await make(20000, true);
    const draft = await make(5000, false);

    await page.goto(`/o/${data.orgId}/finance/invoices/payments`);
    await page.getByRole('button', { name: 'Record payment' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Record payment' });
    await dialog.getByLabel('Client').selectOption({ label: c.name });
    // Only open invoices can take the payment; the draft is not offered.
    await expect(dialog.getByLabel(`Amount for ${first.number}`)).toBeVisible();
    await expect(dialog.getByLabel(`Amount for ${second.number}`)).toBeVisible();
    await expect(dialog.getByLabel(`Amount for ${draft.number}`)).toHaveCount(0);

    await dialog.getByLabel('Amount (USD)').fill('250');
    await dialog.getByRole('button', { name: 'Oldest first' }).click();
    await expect(dialog.getByText(`${usd(25000)} of ${usd(25000)}`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByText('Payment recorded')).toBeVisible();

    // 250.00 paid the first (100.00) in full and 150.00 of the second.
    const open = await ok<Array<{ number: string; balance_minor: number }>>(await api.get(orgApi(`/invoices?client_id=${c.id}&status=OPEN`)), 'open');
    expect(open.map((i) => [i.number, i.balance_minor])).toEqual([[second.number, 5000]]);
  });
});

test.describe('Invoices (no money access)', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone without invoice or payment access sees neither the menu item nor the pages', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/finance/budgets`);
    await expect(page.getByRole('heading', { level: 1, name: 'Budgets' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Primary' }).getByRole('link', { name: 'Invoices' })).toHaveCount(0);

    for (const path of ['/finance/invoices', '/finance/invoices/payments', '/finance/invoices/new']) {
      await page.goto(`/o/${data.orgId}${path}`);
      await expect(page.getByText('Restricted')).toBeVisible();
    }
  });
});
