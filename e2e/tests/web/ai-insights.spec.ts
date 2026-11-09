import AxeBuilder from '@axe-core/playwright';
import { request, type Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * AI Insights: workforce, timesheet and project findings computed by the API from what the person
 * may see. The E2E server runs the deterministic fake model, which answers "Here is what I found"
 * from the tool it called; the findings themselves never come from a model.
 */

const cards = (page: Page) => page.getByTestId('insight-card');
const open = async (page: Page, orgId: string, query = '') => {
  await page.goto(`/o/${orgId}/ai-insights${query}`);
  await expect(page.getByRole('heading', { level: 1, name: 'AI Insights' })).toBeVisible();
};
const lastAnswer = (page: Page) => page.getByTestId('assistant-panel').locator('[data-testid="assistant-message"][data-role="assistant"]').last();

test.describe('AI Insights (system admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('shows labelled findings by tab, and WorkPulse AI explains one', { tag: '@smoke' }, async ({ page, data }) => {
    await open(page, data.orgId);
    await expect(page.getByText('Measured from your organization’s data.')).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Period' }).getByRole('radio', { name: 'This week' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/Compared with \d{4}-\d{2}-\d{2} – \d{4}-\d{2}-\d{2}/)).toBeVisible();

    await page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Workforce' }).click();
    await expect(page).toHaveURL(/tab=workforce/);
    const trend = page.locator('[data-testid="insight-card"][data-category="hours_trend"]');
    await expect(trend).toBeVisible();
    await expect(trend).toContainText('Compared with previous period');
    await expect(trend).toContainText('Next step');

    await trend.getByRole('button', { name: 'Explain with WorkPulse AI' }).click();
    const panel = page.getByTestId('assistant-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-role="user"]').last()).toContainText('Explain this insight');
    await expect(lastAnswer(page)).toContainText('Here is what I found', { timeout: 15_000 });
  });

  test('the Timesheets tab lists people who have not submitted last week', async ({ page, data }) => {
    await open(page, data.orgId, '?tab=timesheets&period=last_week');
    const missing = page.locator('[data-testid="insight-card"][data-category="missing"]');
    await expect(missing).toBeVisible();
    await expect(missing).toContainText(data.newcomer.name);
    await expect(missing).toContainText('Measured');
    await expect(missing.getByRole('link', { name: 'Approvals' })).toBeVisible();
  });

  test('the Projects tab notes a project near its hours budget, linking to budgets', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const name = `Budgeted ${uid()}`;
    const project = await ok<{ id: string }>(await api.post(orgApi('/projects'), { data: { name, member_ids: [data.worker.membershipId] } }), 'project');
    // 9 h of the worker's time long ago (no overlap with other specs), on a 10 h budget: 90 %.
    await ok(await api.post(orgApi('/manual-time'), { data: { membership_id: data.worker.membershipId, project_id: project.id, started_at: '2025-03-03T01:00:00Z', ended_at: '2025-03-03T10:00:00Z', reason: 'Budget test' } }), 'time');
    await ok(await api.put(orgApi('/budgets'), { data: { subject_type: 'PROJECT', subject_id: project.id, kind: 'HOURS', amount: 10 * 3600, warn_pct: 80, include_non_billable: true } }), 'budget');
    await expect.poll(async () => (await ok<Array<{ subject_id: string; state: string }>>(await api.get(orgApi('/budgets')), 'budgets')).find((b) => b.subject_id === project.id)?.state, { timeout: 20_000 }).toBe('warning');

    await open(page, data.orgId, '?tab=projects');
    const near = page.locator('[data-testid="insight-card"][data-category="budget_near"]').filter({ hasText: name });
    await expect(near).toBeVisible();
    await expect(near).toContainText('90 %');
    await expect(near.getByRole('link', { name: 'Budgets' })).toHaveAttribute('href', `/o/${data.orgId}/finance/budgets`);
  });

  test('shows an error with a retry when insights cannot be loaded', async ({ page, data }) => {
    let fail = true;
    await page.route('**/assistant/insights/**', (route) => (fail ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Server error', status: 500 }) }) : route.continue()));
    await open(page, data.orgId);
    await expect(page.getByRole('alert').filter({ hasText: 'Server error' })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: /try again|retry/i }).click();
    await expect(cards(page).first().or(page.getByText('Nothing needs your attention for this period'))).toBeVisible();
  });

  test('findings stay on screen when the AI fails', async ({ page, data }) => {
    await open(page, data.orgId, '?tab=workforce');
    await expect(page.locator('[data-testid="insight-card"][data-category="hours_trend"]')).toBeVisible();
    await page.getByTestId('assistant-launcher').click();
    const panel = page.getByTestId('assistant-panel');
    await panel.getByTestId('assistant-input').fill('error-test');
    await expect(panel.getByTestId('assistant-send')).toBeEnabled();
    await panel.getByTestId('assistant-input').press('Enter');
    await expect(panel.getByTestId('assistant-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="insight-card"][data-category="hours_trend"]')).toBeVisible();
  });

  test('the report runner has WorkPulse AI summarize the report', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/reports`);
    await page.getByRole('link', { name: /Time & activity/ }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Time & activity' })).toBeVisible();
    await page.getByRole('button', { name: 'Summarize with WorkPulse AI' }).click();
    const panel = page.getByTestId('assistant-panel');
    await expect(panel.locator('[data-role="user"]').last()).toContainText('Summarize the Time & activity report');
    await expect(lastAnswer(page)).toContainText('Here is what I found', { timeout: 15_000 });
  });

  test('is accessible in dark mode', async ({ page, data }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, data.orgId, '?tab=workforce');
    await expect(cards(page).first()).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
  });
});

test.describe('AI Insights for people with less access', () => {
  test('a team manager sees only their own scope', async ({ browser, data }) => {
    const ctx = await browser.newContext({ storageState: MANAGER_STATE });
    const page = await ctx.newPage();
    await open(page, data.orgId, '?tab=workforce');
    await expect(page.locator('[data-testid="insight-card"][data-category="hours_trend"]')).toBeVisible();
    const api = await request.newContext({ baseURL: WEB_URL, storageState: MANAGER_STATE });
    const today = new Date().toISOString().slice(0, 10);
    for (const section of ['workforce', 'timesheets', 'projects']) {
      const res = await api.get(`/api/v1/orgs/${data.orgId}/assistant/insights/${section}?from=${today}&to=${today}`);
      expect(res.status()).toBe(200);
      const text = await res.text();
      // The admin and the budget viewer are not on the manager's team.
      expect(text).not.toContain(data.admin.name);
      expect(text).not.toContain(data.viewer.name);
    }
    await Promise.all([api.dispose(), ctx.close()]);
  });

  test('a role without organization access is told so, and the API refuses them', async ({ browser, data }) => {
    const ctx = await browser.newContext({ storageState: VIEWER_STATE });
    const page = await ctx.newPage();
    await page.goto(`/o/${data.orgId}/ai-insights`);
    await expect(page.getByText('Restricted')).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    const api = await request.newContext({ baseURL: WEB_URL, storageState: VIEWER_STATE });
    const today = new Date().toISOString().slice(0, 10);
    expect((await api.get(`/api/v1/orgs/${data.orgId}/assistant/insights/overview?from=${today}&to=${today}`)).status()).toBe(403);
    await Promise.all([api.dispose(), ctx.close()]);
  });
});
