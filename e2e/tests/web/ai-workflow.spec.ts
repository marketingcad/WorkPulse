import { request, type Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * AI Intelligence, Phase 2: the Workflow tab, Write with AI, reminder drafts, expense category
 * suggestions and the bell's priority and grouping. The E2E server runs the deterministic fake
 * model: a draft comes back as "Draft: <the instruction>". Nothing here is ever sent.
 */

const card = (page: Page, category: string) => page.locator(`[data-testid="insight-card"][data-category="${category}"]`);

test.describe('AI workflow (system admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('the Workflow tab lists what waits for a decision, in a suggested order', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    // Time for the newcomer, submitted on their behalf: it waits for approval.
    const day = '2025-04-07';
    await ok(await api.post(orgApi('/manual-time'), { data: { membership_id: data.newcomer.membershipId, project_id: data.projects.website.id, started_at: `${day}T09:00:00Z`, ended_at: `${day}T11:00:00Z`, reason: 'Workflow test' } }), 'time');
    await ok(await api.post(orgApi('/timesheets/submit'), { data: { membership_id: data.newcomer.membershipId, date: day } }), 'submit');

    await page.goto(`/o/${data.orgId}/ai-insights?tab=workflow`);
    await expect(page.getByRole('heading', { level: 1, name: 'AI Insights' })).toBeVisible();
    const first = card(page, 'review_first');
    await expect(first).toBeVisible();
    await expect(first).toContainText(data.newcomer.name);
    await expect(first).toContainText('Measured');
    await expect(first.getByRole('link', { name: 'Approvals' })).toBeVisible();
    await expect(card(page, 'backlog_mix')).toContainText('Timesheets');
  });

  test('Write with AI rewrites a task description into the field, and Undo puts it back', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/projects/${data.projects.website.id}`);
    await page.getByRole('button', { name: /New task/ }).first().click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByLabel('Description') });
    const desc = dialog.getByLabel('Description');
    const typed = `fix login bug asap ${uid()}`;
    await desc.fill(typed);
    await dialog.getByRole('button', { name: 'Write with AI' }).click();
    await page.getByRole('menuitem', { name: 'More professional' }).click();
    await expect(desc).toHaveValue(/^Draft: Rewrite it in a professional tone\./);
    await expect(dialog.getByText('Written by WorkPulse AI. Check it before saving')).toBeVisible();
    await dialog.getByRole('button', { name: 'Undo' }).click();
    await expect(desc).toHaveValue(typed);
  });

  test('a draft that arrives late changes only the description, never fields edited meanwhile', async ({ page, data }) => {
    // Hold the draft back so the person can keep editing while it is written.
    await page.route('**/assistant/drafts', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto(`/o/${data.orgId}/projects/${data.projects.website.id}`);
    await page.getByRole('button', { name: /New task/ }).first().click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByLabel('Description') });
    await dialog.getByLabel('Title').fill(`Late draft ${uid()}`);
    await dialog.getByLabel('Description').fill('make the button blue');
    await dialog.getByRole('button', { name: 'Write with AI' }).click();
    await page.getByRole('menuitem', { name: 'Improve writing' }).click();
    // While it is written, the description cannot be typed over, and other fields can still change.
    await expect(dialog.getByLabel('Description')).toHaveAttribute('readonly', '');
    await dialog.getByLabel('Priority').selectOption('HIGH');
    await expect(dialog.getByLabel('Description')).toHaveValue(/^Draft: /);
    await expect(dialog.getByLabel('Priority')).toHaveValue('HIGH');
  });

  test('when WorkPulse AI fails, the field keeps what was typed and says so', async ({ page, data }) => {
    await page.route('**/assistant/drafts', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ title: 'The AI service is unavailable.', status: 503, code: 'ai_unavailable' }) }));
    await page.goto(`/o/${data.orgId}/projects/${data.projects.website.id}`);
    await page.getByRole('button', { name: /New task/ }).first().click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByLabel('Description') });
    await dialog.getByLabel('Description').fill('keep this text');
    await dialog.getByRole('button', { name: 'Write with AI' }).click();
    await page.getByRole('menuitem', { name: 'Improve writing' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Your text is unchanged');
    await expect(dialog.getByLabel('Description')).toHaveValue('keep this text');
  });

  test('Draft reminder on missing timesheets opens an editable draft to copy, with no Send', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/ai-insights?tab=timesheets&period=last_week`);
    const missing = card(page, 'missing');
    await expect(missing).toBeVisible();
    await missing.getByRole('button', { name: 'Draft reminder' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reminder draft' });
    await expect(dialog).toContainText('WorkPulse does not send it.');
    const text = dialog.getByLabel('Message');
    await expect(text).toHaveValue(/^Draft: Write a short, friendly reminder email/);
    await text.fill('Hi all, please submit your timesheets today.');
    await expect(dialog.getByRole('button', { name: 'Copy' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: /send/i })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('a new expense suggests a category from its description, and never overwrites one', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/finance/expenses`);
    await page.getByRole('button', { name: 'New expense' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New expense' });
    await dialog.getByLabel('Description').fill('Taxi to the client office');
    const suggestion = dialog.getByTestId('category-suggestion');
    await expect(suggestion).toContainText('Suggested category: Travel');
    await suggestion.getByRole('button', { name: 'Use' }).click();
    await expect(dialog.getByLabel('Category')).toHaveValue('Travel');
    await expect(suggestion).toHaveCount(0);
    // A category the person typed is never replaced.
    await dialog.getByLabel('Category').fill('Meals');
    await dialog.getByLabel('Description').fill('Taxi again');
    await expect(dialog.getByTestId('category-suggestion')).toHaveCount(0);
    await expect(dialog.getByLabel('Category')).toHaveValue('Meals');
  });

  test('the bell groups notifications of one kind and marks urgent ones', async ({ page, data }) => {
    const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const n = (id: string, type: string, priority: string, title: string, h: number) => ({ id, type, priority, title, body: null, link: '/timesheets/approvals', read_at: null, created_at: at(h) });
    await page.route('**/notifications', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              unread: 4,
              data: [
                n('n1', 'budget.exceeded', 'critical', 'Website is over budget', 1),
                n('n2', 'timesheet.submitted', 'important', 'Nina submitted a timesheet', 2),
                n('n3', 'timesheet.submitted', 'important', 'Wade submitted a timesheet', 3),
                n('n4', 'timesheet.submitted', 'important', 'Vera submitted a timesheet', 4),
              ],
            }),
          })
        : route.continue(),
    );
    await page.goto(`/o/${data.orgId}`);
    await page.getByRole('button', { name: /notifications/i }).first().click();
    await expect(page.getByText('Website is over budget')).toBeVisible();
    await expect(page.getByText('Urgent', { exact: true })).toBeVisible();
    await expect(page.getByText('Nina submitted a timesheet')).toBeVisible();
    const more = page.getByRole('button', { name: '+2 more' });
    await expect(more).toBeVisible();
    await expect(page.getByText('Wade submitted a timesheet')).toHaveCount(0);
    await more.click();
    await expect(page.getByText(/Wade submitted a timesheet/)).toBeVisible();
    // Opening the group marks every notification in it read, not only the first.
    const read = page.waitForRequest((r) => r.url().endsWith('/notifications/read') && r.method() === 'POST');
    await page.getByText('Nina submitted a timesheet').click();
    expect((await read).postDataJSON()).toEqual({ ids: ['n2', 'n3', 'n4'] });
  });
});

test.describe('AI drafts for people with less access', () => {
  test('a manager cannot draft from a project outside their scope, and a role without organization access cannot draft at all', async ({ data, adminApi }) => {
    const other = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Not theirs ${uid()}` } }), 'project');
    const manager = await request.newContext({ baseURL: WEB_URL, storageState: MANAGER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    expect((await manager.post(`/api/v1/orgs/${data.orgId}/assistant/drafts`, { data: { kind: 'project_description', project_id: other.id } })).status()).toBe(404);
    const viewer = await request.newContext({ baseURL: WEB_URL, storageState: VIEWER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    expect((await viewer.post(`/api/v1/orgs/${data.orgId}/assistant/drafts`, { data: { kind: 'rewrite', text: 'hello', style: 'improve' } })).status()).toBe(403);
    await Promise.all([manager.dispose(), viewer.dispose()]);
  });
});
