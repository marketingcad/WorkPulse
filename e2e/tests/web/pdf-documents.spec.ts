import { readFileSync } from 'node:fs';
import { request } from '@playwright/test';
import { expect, ok, test, uid, usd } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, WEB_URL, WORKER_STATE } from '../../support/env';
import { flatText } from '../../support/pdf-text';

/**
 * The finance documents as people download them: the report PDF from the Reports page, the invoice
 * PDF from the invoice page, and a worker's pay stub. Each carries the organization's header, the real
 * figures, and "Page X of Y"; long text is printed in full. People who may not see a document cannot
 * download it.
 */

const as = (state: string) => request.newContext({ baseURL: WEB_URL, storageState: state, extraHTTPHeaders: { Origin: WEB_URL } });

test.describe('PDF documents (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the report PDF from the Reports page has the company header, the report and page numbers', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const org = await ok<{ organization: { name: string } }>(await adminApi.api.get(adminApi.orgApi('')), 'org');
    await page.goto(`/o/${data.orgId}/reports`);
    await page.getByRole('link', { name: /Time & activity/ }).first().click();
    await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
    await page.getByRole('button', { name: 'Export' }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'PDF', exact: true }).click();
    const file = await pending;
    const text = flatText(readFileSync((await file.path())!));
    expect(text).toContain(org.organization.name);
    expect(text).toContain('TIME & ACTIVITY');
    expect(text).toMatch(/PERIOD [A-Z][a-z]{2} \d{1,2}/);
    expect(text).toMatch(/Page 1 of \d+/);
    expect(text).not.toMatch(/\d USD/); // money is "$1,234.50", never "1234.50 USD"
  });

  test('the invoice PDF prints the invoice in full, including a long description', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const run = uid();
    const longDesc = `Platform engineering ${run}: migration of the reporting pipeline to the new data warehouse, including validation of every historical figure and a hand-over session with the finance team`;
    const client = await ok<{ id: string }>(await api.post(orgApi('/clients'), { data: { name: `Contoso ${run}`, email: `ap+${run}@contoso.test` } }), 'client');
    const inv = await ok<{ id: string; number: string; total_minor: number }>(
      await api.post(orgApi('/invoices'), { data: { client_id: client.id, period_start: '2026-01-01', period_end: '2026-01-31', issue_date: '2026-02-01', due_date: '2026-03-03', include_expenses: false, extra_lines: [{ description: longDesc, quantity: 2, unit_price_minor: 45000 }] } }),
      'invoice',
    );

    await page.goto(`/o/${data.orgId}/finance/invoices/${inv.id}`);
    const link = page.getByRole('link', { name: /PDF/ }).first();
    await expect(link).toBeVisible();
    const res = await page.request.get((await link.getAttribute('href'))!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('application/pdf');
    const text = flatText(await res.body());
    for (const s of ['INVOICE', inv.number, `Contoso ${run}`, longDesc, '$450.00', usd(inv.total_minor), 'Feb 1, 2026', 'Mar 3, 2026', 'Jan 1 – Jan 31, 2026', 'BALANCE DUE', 'Page 1 of 1']) expect(text).toContain(s);
    expect(text).not.toContain('…');

    // A worker or a team manager cannot download it.
    for (const state of [WORKER_STATE, MANAGER_STATE]) {
      const other = await as(state);
      expect([403, 404]).toContain((await other.get(`/api/v1/orgs/${data.orgId}/invoices/${inv.id}/pdf`)).status());
      await other.dispose();
    }
  });
});

test.describe('PDF documents (worker)', () => {
  test.use({ storageState: WORKER_STATE });

  test('a worker’s pay stub PDF shows their pay with the earnings and the net pay', async ({ data }) => {
    const worker = await as(WORKER_STATE);
    const res = await worker.get(`/api/v1/orgs/${data.orgId}/pay-stubs/${data.payStub.id}/pdf`);
    expect(res.status()).toBe(200);
    const text = flatText(await res.body());
    for (const s of ['PAY STUB', data.worker.name, 'EARNINGS', 'Gross pay', usd(data.payStub.grossMinor), 'NET PAY', usd(data.payStub.netMinor), 'Page 1 of 1', 'Confidential']) expect(text).toContain(s);
    await worker.dispose();

    // A team manager has no payroll access, so cannot open it.
    const manager = await as(MANAGER_STATE);
    expect([403, 404]).toContain((await manager.get(`/api/v1/orgs/${data.orgId}/pay-stubs/${data.payStub.id}/pdf`)).status());
    await manager.dispose();
  });
});
