import { request } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, PASSWORD, WEB_URL } from '../../support/env';

/**
 * AI Intelligence, Phase 4: the client's AI summary in the portal (off until the organization turns it
 * on, delivery facts only) and the forecasts in AI Insights (project finish, month-end hours). The
 * deterministic fake model writes "Draft: …".
 */
test.describe('Client portal AI summary', () => {
  test.use({ storageState: ADMIN_STATE });

  test('off by default; once the admin turns it on, the client sees a summary of their own projects', { tag: '@smoke' }, async ({ browser, page, data, adminApi }) => {
    const name = `Summary Client ${uid()}`;
    const c = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name } }), 'client');
    const p = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Summary Project ${uid()}`, client_id: c.id, member_ids: [data.worker.membershipId] } }), 'project');
    const done = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi(`/projects/${p.id}/tasks`), { data: { title: 'Wireframes', assignee_ids: [data.worker.membershipId] } }), 'task');
    await ok(await adminApi.api.patch(adminApi.orgApi(`/tasks/${done.id}`), { data: { project_id: p.id, status: 'DONE' } }), 'task done');
    await ok(await adminApi.api.post(adminApi.orgApi(`/projects/${p.id}/tasks`), { data: { title: 'Build pages' } }), 'open task');
    await ok(await adminApi.api.put(adminApi.orgApi(`/clients/${c.id}/portal`), { data: { enabled: true } }), 'portal on');
    const invite = await ok<{ invite_url: string }>(await adminApi.api.post(adminApi.orgApi(`/clients/${c.id}/portal/invitations`), { data: { email: `summary+${uid()}@e2e.test`, name: 'Sam Summary' } }), 'invite');

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const client = await ctx.newPage();
    try {
      const link = new URL(invite.invite_url);
      await client.goto(link.pathname + link.search);
      await client.getByLabel('Your name').fill('Sam Summary');
      await client.getByLabel('Choose a password').fill(PASSWORD);
      await client.getByRole('button', { name: 'Open dashboard' }).click();
      await expect(client.getByRole('heading', { level: 1, name })).toBeVisible({ timeout: 20_000 });
      // Off by default: no summary, and the API refuses it.
      await expect(client.getByTestId('portal-ai-summary')).toHaveCount(0);
      const accessId = new URL(client.url()).pathname.split('/').pop()!;
      expect((await client.request.get(`/api/v1/portal/${accessId}/ai-summary`)).status()).toBe(403);

      // The admin turns it on in the client's portal settings.
      await page.goto(`/o/${data.orgId}/clients/${c.id}/portal`);
      const box = page.getByRole('checkbox', { name: 'A short summary written by WorkPulse AI' });
      await expect(box).not.toBeChecked();
      await expect(page.getByText('never money, hours or names', { exact: false })).toBeVisible();
      await box.click();
      await expect(box).toBeChecked();

      await client.reload();
      const card = client.getByTestId('portal-ai-summary');
      await expect(card).toHaveAttribute('data-source', 'ai', { timeout: 15_000 });
      await expect(card).toContainText('Draft:');
      await expect(card).toContainText('Written by WorkPulse AI');
      await expect(card).not.toContainText(/\$\d|hours?\b/i);
      await expect(card).not.toContainText(data.worker.name);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('Client portal AI summary, for a team manager', () => {
  test('cannot switch it on', async ({ data, adminApi }) => {
    const c = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: `Mgr Client ${uid()}` } }), 'client');
    const api = await request.newContext({ baseURL: WEB_URL, storageState: MANAGER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    expect((await api.put(`/api/v1/orgs/${data.orgId}/clients/${c.id}/portal`, { data: { sections: { ai_summary: true } } })).status()).toBe(403);
    await api.dispose();
  });
});

test.describe('Forecasts in AI Insights', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a project likely to finish after its end date is flagged, as an estimate', async ({ page, data, adminApi }) => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const p = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Forecast ${uid()}`, member_ids: [data.worker.membershipId], end_date: tomorrow } }), 'project');
    for (let i = 0; i < 6; i++) {
      const task = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi(`/projects/${p.id}/tasks`), { data: { title: `Step ${i + 1}` } }), 'task');
      if (i === 0) await ok(await adminApi.api.patch(adminApi.orgApi(`/tasks/${task.id}`), { data: { project_id: p.id, status: 'DONE' } }), 'done');
    }
    await page.goto(`/o/${data.orgId}/ai-insights?tab=projects&period=this_month`);
    const card = page.locator('[data-testid="insight-card"][data-category="finish_forecast"]').first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-basis', 'estimate');
    await expect(card).toContainText('Estimate');
  });

  test('Workforce shows the month-end hours estimate, or says it is too early', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/ai-insights?tab=workforce&period=this_month`);
    await expect(page.locator('[data-testid="insight-card"][data-category="month_end_hours"]').or(page.getByText('Too early in the month to project month-end hours.')).first()).toBeVisible();
  });
});
