import AxeBuilder from '@axe-core/playwright';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD } from '../../support/env';

/**
 * Client portal Insights (Performance Center): the client sees how their own projects are delivered
 * (tasks, milestones the team shared, weekly progress) and can thank the team; the message waits for
 * the organization's approval. A milestone the team hid never shows, and nothing about money,
 * scores or people's activity is on the tab.
 */
test.describe('Client portal insights', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a client viewer sees delivery facts, not hidden milestones, and sends appreciation for review', { tag: '@smoke' }, async ({ browser, data, adminApi }) => {
    const client = `Insights Client ${uid()}`;
    const project = `Insights Project ${uid()}`;
    const c = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: client } }), 'client');
    const p = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: project, client_id: c.id, member_ids: [data.worker.membershipId] } }), 'project');
    await ok(await adminApi.api.post(adminApi.orgApi(`/projects/${p.id}/milestones`), { data: { title: 'Landing pages live', due_date: '2099-03-31', client_visible: true } }), 'shared milestone');
    await ok(await adminApi.api.post(adminApi.orgApi(`/projects/${p.id}/milestones`), { data: { title: 'Internal QA pass', due_date: '2099-03-15', client_visible: false } }), 'hidden milestone');
    const task = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi(`/projects/${p.id}/tasks`), { data: { title: 'Write copy', assignee_ids: [data.worker.membershipId] } }), 'task');
    await ok(await adminApi.api.patch(adminApi.orgApi(`/tasks/${task.id}`), { data: { project_id: p.id, status: 'DONE' } }), 'task done');
    await ok(await adminApi.api.post(adminApi.orgApi(`/projects/${p.id}/tasks`), { data: { title: 'Review copy' } }), 'open task');
    await ok(await adminApi.api.put(adminApi.orgApi(`/clients/${c.id}/portal`), { data: { enabled: true, sections: { hours: true, tasks: true, activity: false, screenshots: false } } }), 'portal settings');
    const invite = await ok<{ invite_url: string }>(await adminApi.api.post(adminApi.orgApi(`/clients/${c.id}/portal/invitations`), { data: { email: `insights+${uid()}@e2e.test`, name: 'Ina Insights' } }), 'portal invite');

    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      const link = new URL(invite.invite_url);
      await page.goto(link.pathname + link.search);
      await page.getByLabel('Your name').fill('Ina Insights');
      await page.getByLabel('Choose a password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Open dashboard' }).click();
      await expect(page.getByRole('heading', { level: 1, name: client })).toBeVisible({ timeout: 20_000 });

      await page.getByRole('button', { name: 'Insights', exact: true }).or(page.getByRole('tab', { name: 'Insights' })).first().click();
      await expect(page.getByText('How your projects are being delivered', { exact: false })).toBeVisible();
      for (const k of ['Completion', 'Tasks done', 'Tasks open', 'Milestones done', 'On time']) await expect(page.getByText(k, { exact: true }).first()).toBeVisible();
      await expect(page.getByText('50%').first()).toBeVisible(); // one of two tasks done
      const timeline = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Milestones', exact: true }) });
      await expect(timeline).toContainText('Landing pages live');
      await expect(timeline).not.toContainText('Internal QA pass');
      // A stepper: the next milestone is marked, and the row is a region the keyboard can scroll.
      const stepper = page.getByRole('region', { name: `Milestones: ${project}` });
      await expect(stepper).toHaveAttribute('tabindex', '0');
      await expect(stepper.getByRole('listitem').filter({ hasText: 'Landing pages live' })).toContainText('Next');
      await expect(page.getByRole('heading', { name: 'Tasks completed per week' })).toBeVisible();
      // Delivery facts only.
      await expect(page.locator('main, body').first()).not.toContainText(/score|leaderboard|rate|\$\d|screenshot/i);
      // No serious or critical WCAG 2.1 A/AA violation, as in the signed-in accessibility sweep.
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help} e.g. ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
      // On a phone it fits without sideways scrolling.
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.setViewportSize({ width: 1280, height: 800 });

      // Appreciation: what is missing is said; then it is sent and held for review.
      const form = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Appreciate the team' }) });
      await form.getByRole('button', { name: 'Send appreciation' }).click();
      await expect(form.getByText('Write a short message.')).toBeVisible();
      await expect(form.getByLabel('Project')).toHaveValue(p.id);
      await form.getByLabel('Who').selectOption({ label: data.worker.name });
      await form.getByLabel('Your message').fill('The copy was ready a week early. Thank you!');
      await form.getByRole('button', { name: 'Send appreciation' }).click();
      await expect(form.getByRole('status')).toContainText('waiting for the team’s organization to review it');
    } finally {
      await context.close();
    }

    // It waits for the organization's approval; nobody sees it before that.
    const waiting = await ok<Array<{ message: string; status: string; member: { name: string } | null; client: { name: string } }>>(await adminApi.api.get(adminApi.orgApi('/performance/appreciations?status=PENDING')), 'appreciations');
    const mine = waiting.find((a) => a.client.name === client);
    expect(mine).toMatchObject({ status: 'PENDING', message: 'The copy was ready a week early. Thank you!', member: { name: data.worker.name } });
  });

  test('the appreciation notification opens Waiting for approval', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/performance/achievements?tab=appreciation`);
    await expect(page.getByRole('tab', { name: /^Waiting for approval/ })).toHaveAttribute('aria-selected', 'true');
  });
});
