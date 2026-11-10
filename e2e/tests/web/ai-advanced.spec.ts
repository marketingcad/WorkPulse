import { request, type Page } from '@playwright/test';
import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * AI Intelligence, Phase 3: capacity, finance (finance roles only) and performance explanations.
 * Findings are computed by the API; the deterministic fake model answers "Here is what I found".
 */
const tabs = (page: Page) => page.getByRole('group', { name: 'Sections' });
const settled = (page: Page) => page.getByTestId('insight-card').or(page.getByText('Nothing needs your attention for this period')).or(page.getByRole('note').filter({ hasText: 'Not included' })).first();

test.describe('AI Insights, phase 3 (system admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the Capacity tab covers the next two weeks', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/ai-insights`);
    await tabs(page).getByRole('button', { name: 'Capacity' }).click();
    await expect(page).toHaveURL(/tab=capacity/);
    await expect(settled(page)).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: /error|failed/i })).toHaveCount(0);
  });

  test('the Finance tab shows an overdue invoice with its currency, and every view is audited', async ({ page, data, adminApi }) => {
    // A sent invoice that was due yesterday and is unpaid: 100.00 overdue.
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const client = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: `Overdue Co ${Date.now()}` } }), 'client');
    const inv = await ok<{ id: string }>(
      await adminApi.api.post(adminApi.orgApi('/invoices'), {
        data: { client_id: client.id, period_start: yesterday, period_end: yesterday, issue_date: yesterday, due_date: yesterday, group_by: 'project', tax_rate_bps: 0, include_expenses: false, notes: null, extra_lines: [{ description: 'Retainer', quantity: 1, unit_price_minor: 10000, tax_rate_bps: 0 }] },
      }),
      'invoice',
    );
    await ok(await adminApi.api.post(adminApi.orgApi(`/invoices/${inv.id}/send`), { data: {} }), 'send');

    await page.goto(`/o/${data.orgId}/ai-insights?tab=finance`);
    await expect(tabs(page).getByRole('button', { name: 'Finance' })).toBeVisible();
    const overdue = page.locator('[data-testid="insight-card"][data-category="overdue_invoices"]');
    await expect(overdue).toBeVisible();
    // Money is formatted with its currency, never shown as raw minor units.
    await expect(overdue).toContainText(/\$\s?[\d,]+\.\d{2}/);
    await expect(overdue).not.toContainText(/_minor|10000/);
    const log = await adminApi.api.get(adminApi.orgApi('/audit-logs?action=insights.finance_viewed'));
    expect(log.ok()).toBe(true);
    expect(JSON.stringify(await log.json())).toContain('insights.finance_viewed');
  });

  test('Explain with WorkPulse AI on a performance profile answers from the Performance Center score', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/performance/workers/${data.worker.membershipId}`);
    await page.getByRole('button', { name: 'Explain with WorkPulse AI' }).click();
    const panel = page.getByTestId('assistant-panel');
    await expect(panel.locator('[data-role="user"]').last()).toContainText(`Explain the performance score of ${data.worker.name}`);
    await expect(panel.locator('[data-testid="assistant-message"][data-role="assistant"]').last()).toContainText('Here is what I found', { timeout: 15_000 });
  });
});

test.describe('AI Insights, phase 3, for other roles', () => {
  test('has no Finance tab, and the API returns no money', async ({ browser, data }) => {
    const ctx = await browser.newContext({ storageState: MANAGER_STATE });
    const page = await ctx.newPage();
    await page.goto(`/o/${data.orgId}/ai-insights`);
    await expect(tabs(page).getByRole('button', { name: 'Capacity' })).toBeVisible();
    await expect(tabs(page).getByRole('button', { name: 'Finance' })).toHaveCount(0);
    const api = await request.newContext({ baseURL: WEB_URL, storageState: MANAGER_STATE });
    const today = new Date().toISOString().slice(0, 10);
    const res = await api.get(`/api/v1/orgs/${data.orgId}/assistant/insights/finance?from=${today}&to=${today}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.findings).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/"money"|_minor/);
    await Promise.all([api.dispose(), ctx.close()]);
  });

  test('a view-only role cannot read finance or capacity insights', async ({ data }) => {
    const api = await request.newContext({ baseURL: WEB_URL, storageState: VIEWER_STATE });
    const today = new Date().toISOString().slice(0, 10);
    for (const s of ['finance', 'capacity']) expect((await api.get(`/api/v1/orgs/${data.orgId}/assistant/insights/${s}?from=${today}&to=${today}`)).status()).toBe(403);
    await api.dispose();
  });
});
