import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, VIEWER_STATE, WORKER_STATE } from '../../support/env';
import type { Page } from '@playwright/test';

/**
 * WorkPulse AI assistant. The E2E server runs the deterministic fake provider (never a real
 * model): "hours" looks up hours, "budget" looks up budgets, "approv" suggests the approvals page,
 * "error-test" fails, and anything else searches the help. Answers echo the tool's data.
 */

async function openPanel(page: Page) {
  await page.getByTestId('assistant-launcher').click();
  const panel = page.getByTestId('assistant-panel');
  await expect(panel).toBeVisible();
  return panel;
}

async function ask(page: Page, text: string) {
  const panel = page.getByTestId('assistant-panel');
  await panel.getByTestId('assistant-input').fill(text);
  // Send stays disabled until the previous turn is saved; Enter before then is ignored, as for a person.
  await expect(panel.getByTestId('assistant-send')).toBeEnabled({ timeout: 15_000 });
  await panel.getByTestId('assistant-input').press('Enter');
}

const lastAnswer = (page: Page) => page.getByTestId('assistant-panel').locator('[data-testid="assistant-message"][data-role="assistant"]').last();

test.describe('WorkPulse AI (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('asks a question, gets a streamed answer, and follows a suggested page', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    const panel = await openPanel(page);
    // Welcome state with 3–4 suggestions for this person.
    await expect(panel.getByText('Hi, I’m WorkPulse AI')).toBeVisible();
    const suggestions = panel.getByTestId('assistant-suggestion');
    await expect(suggestions.first()).toBeVisible();
    expect(await suggestions.count()).toBeGreaterThanOrEqual(3);
    expect(await suggestions.count()).toBeLessThanOrEqual(4);

    await ask(page, 'How many hours were tracked this week?');
    await expect(lastAnswer(page)).toContainText('Here is what I found', { timeout: 15_000 });
    await expect(panel.locator('[data-role="user"]').last()).toContainText('How many hours were tracked this week?');

    await ask(page, 'Where do I approve timesheets?');
    const chip = panel.getByTestId('assistant-nav-chip').last();
    await expect(chip).toBeVisible({ timeout: 15_000 });
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/timesheets/approvals`));
    // The panel stays open and usable while the page changes.
    await expect(panel).toBeVisible();
  });

  test('keeps the conversation across reloads; renames, deletes and starts over', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    const panel = await openPanel(page);
    await ask(page, 'How do I invite someone?');
    await expect(lastAnswer(page)).toContainText('Here is what I found', { timeout: 15_000 });

    await page.reload();
    await openPanel(page);
    await expect(panel.locator('[data-role="user"]').first()).toContainText('How do I invite someone?');

    // Rename from the title.
    await panel.getByRole('button', { name: 'How do I invite someone?' }).click();
    const title = panel.getByRole('textbox', { name: 'Rename conversation' });
    await title.fill(`Invites ${data.run}`);
    await title.press('Enter');
    await expect(panel.getByRole('button', { name: `Invites ${data.run}` })).toBeVisible();

    // Delete it from the history, with a confirmation.
    await panel.getByRole('button', { name: 'Conversations' }).click();
    await expect(panel.getByTestId('assistant-history')).toContainText(`Invites ${data.run}`);
    await panel.getByTestId('assistant-history').getByRole('listitem').filter({ hasText: `Invites ${data.run}` }).getByRole('button', { name: 'Delete conversation' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete this conversation?' }).or(page.getByRole('dialog', { name: 'Delete this conversation?' }));
    await confirm.getByRole('button', { name: 'Delete conversation' }).click();
    await expect(panel.getByTestId('assistant-history')).not.toContainText(`Invites ${data.run}`);

    await panel.getByRole('button', { name: 'New chat' }).click();
    await expect(panel.getByText('Hi, I’m WorkPulse AI')).toBeVisible();
  });

  test('shows an error with a retry, and a loading state while history loads', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    const panel = await openPanel(page);
    await ask(page, 'error-test please');
    const error = panel.getByTestId('assistant-error');
    await expect(error).toContainText('The assistant is unavailable right now', { timeout: 15_000 });
    await expect(panel.getByTestId('assistant-retry')).toBeVisible();

    // Slow the conversation fetch: the skeleton shows until it arrives.
    await page.reload();
    await page.route('**/assistant/conversations/*', async (route) => {
      if (route.request().method() === 'GET') await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.getByTestId('assistant-launcher').click();
    await expect(page.getByTestId('assistant-loading')).toBeVisible();
    await expect(page.getByTestId('assistant-loading')).toBeHidden({ timeout: 10_000 });
  });

  test('a reply cut off by the connection says so, and earlier messages stay', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'New chat' }).click();
    await ask(page, 'How do I add a client?');
    await expect(lastAnswer(page)).toContainText('Here is what I found', { timeout: 15_000 });
    // The same question again; this time the stream closes after one delta, with no done event.
    await page.route('**/assistant/conversations/*/messages', (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'event: delta\ndata: {"text":"Partial"}\n\n' }),
    );
    await ask(page, 'How do I add a client?');
    await expect(panel.getByTestId('assistant-error')).toContainText('The answer was interrupted', { timeout: 15_000 });
    await expect(panel.getByTestId('assistant-retry')).toBeVisible();
    // The earlier identical question and its answer are still on screen.
    await expect(panel.locator('[data-role="user"]').filter({ hasText: 'How do I add a client?' }).first()).toBeVisible();
    await expect(panel.locator('[data-role="assistant"]').filter({ hasText: 'Here is what I found' }).first()).toBeVisible();
  });

  test('a double click on a suggestion sends it once', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    const panel = await openPanel(page);
    await panel.getByRole('button', { name: 'New chat' }).click();
    const count = async () => (await (await page.request.get(`/api/v1/orgs/${data.orgId}/assistant/conversations?page=1`)).json()).total as number;
    const before = await count();
    await panel.getByTestId('assistant-suggestion').first().dblclick();
    await expect(lastAnswer(page)).toContainText('Here is what I found', { timeout: 15_000 });
    expect(await count()).toBe(before + 1);
    await expect(panel.locator('[data-role="user"]')).toHaveCount(1);
  });

  test('the launcher never covers the open calculator', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await page.getByRole('button', { name: 'Open calculator' }).click();
    const launcher = (await page.getByTestId('assistant-launcher').boundingBox())!;
    const calcPanel = page.getByRole('dialog', { name: 'Calculator' });
    await expect(calcPanel).toBeVisible();
    const box = (await calcPanel.boundingBox())!;
    const overlaps = launcher.x < box.x + box.width && launcher.x + launcher.width > box.x && launcher.y < box.y + box.height && launcher.y + launcher.height > box.y;
    expect(overlaps).toBe(false);
  });

  test('Escape closes the panel and focus returns to the launcher', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await openPanel(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('assistant-panel')).toBeHidden();
    await expect(page.getByTestId('assistant-launcher')).toBeFocused();
  });

  test('copies an answer', async ({ page, data, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/o/${data.orgId}`);
    await openPanel(page);
    await ask(page, 'What can I do in WorkPulse?');
    await expect(lastAnswer(page)).toContainText('Here is what I found', { timeout: 15_000 });
    await lastAnswer(page).getByTestId('assistant-copy').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Here is what I found');
  });
});

test.describe('WorkPulse AI layout', () => {
  test.use({ storageState: ADMIN_STATE });

  test('is a side panel on desktop that leaves the navigation usable', async ({ page, data }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/o/${data.orgId}`);
    const panel = await openPanel(page);
    const box = (await panel.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(401);
    expect(box.x + box.width).toBeGreaterThanOrEqual(1279);
    // The sidebar is not covered: a navigation link still works.
    await page.getByRole('link', { name: 'Projects', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/projects`));
    await expect(panel).toBeVisible();
  });

  for (const width of [900, 390]) {
    test(`fits the screen at ${width}px`, async ({ page, data }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/o/${data.orgId}`);
      const panel = await openPanel(page);
      const box = (await panel.boundingBox())!;
      if (width < 768) expect(box.width).toBeGreaterThanOrEqual(width - 1);
      else expect(box.width).toBeLessThanOrEqual(401);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(panel.getByTestId('assistant-input')).toBeVisible();
    });
  }
});

test.describe('WorkPulse AI (team manager)', () => {
  test.use({ storageState: MANAGER_STATE });

  test('gets team-scoped answers, no money, and no link to pages they cannot open', async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    // As the admin: a money budget on the website project, which the manager is assigned to.
    const put = await api.put(orgApi('/budgets'), { data: { subject_type: 'PROJECT', subject_id: data.projects.website.id, kind: 'MONEY', amount: 750_000, warn_pct: 80 } });
    expect(put.status()).toBe(200);
    const budgetId = (await put.json()).id as string;
    try {
      await page.goto(`/o/${data.orgId}`);
      const panel = await openPanel(page);
      await ask(page, 'How is the budget?');
      const answer = lastAnswer(page);
      await expect(answer).toContainText('Here is what I found', { timeout: 15_000 });
      await expect(answer).toContainText('percent_used');
      await expect(answer).not.toContainText('"amount"');
      await expect(answer).not.toContainText('7500');

      // Payroll and invoices are not theirs: their questions are not suggested.
      await panel.getByRole('button', { name: 'New chat' }).click();
      for (const q of await panel.getByTestId('assistant-suggestion').allTextContents()) expect(q).not.toMatch(/payroll|invoice/i);
    } finally {
      await api.delete(orgApi(`/budgets/${budgetId}`));
    }
  });
});

test.describe('WorkPulse AI is not offered to everyone', () => {
  test.describe('a web role without organization access', () => {
    test.use({ storageState: VIEWER_STATE });
    test('has no launcher', async ({ page, data }) => {
      await page.goto(`/o/${data.orgId}/finance/budgets`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByTestId('assistant-launcher')).toHaveCount(0);
    });
  });

  test.describe('a worker', () => {
    test.use({ storageState: WORKER_STATE });
    test('is refused by the API', async ({ page, data }) => {
      await page.goto('/download');
      const origin = new URL(page.url()).origin;
      const r = await page.request.get(`${origin}/api/v1/orgs/${data.orgId}/assistant/conversations`);
      expect(r.status()).toBe(403);
    });
  });
});
