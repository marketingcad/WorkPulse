import type { Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { MANAGER_STATE } from '../../support/env';

/**
 * QA audit, 11 Nov 2026 (BUG-09). A Team Manager adding time for a team member opened the project
 * picker and read "You are not assigned to any active project yet": the list was built before the
 * member's teams had loaded, and when that request failed (an intermittent server error) it stayed
 * empty. Now it waits, says so, and offers Retry. Mona Lead manages the Design team, which Wade Worker
 * is in; Wade is on the Website project. Nothing is saved.
 */
test.use({ storageState: MANAGER_STATE });

async function openAddTimeFor(page: Page, orgId: string, member: string) {
  await page.goto(`/o/${orgId}/timesheets/all`);
  await expect(page.getByRole('heading', { level: 1, name: 'Time entries' })).toBeVisible();
  await page.getByRole('button', { name: 'Add time' }).first().click();
  const dialog = page.getByRole('dialog', { name: /Add time/ });
  await dialog.getByLabel('Member').selectOption({ label: member });
  return dialog;
}

test('a manager adding time for a team member sees a loading state, then the team’s project', { tag: '@smoke' }, async ({ page, data }) => {
  // Hold the member's details back, as a slow server would.
  await page.route(`**/api/v1/orgs/${data.orgId}/workers/${data.worker.membershipId}`, async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  const dialog = await openAddTimeFor(page, data.orgId, data.worker.name);
  await dialog.getByRole('button', { name: 'Choose project and task' }).click();
  await expect(page.getByText('Loading projects…')).toBeVisible();
  await expect(page.getByText(/not assigned to any active project/)).toHaveCount(0);
  await expect(page.getByRole('option', { name: new RegExp(data.projects.website.name) }).first()).toBeVisible();
});

test('when the member’s details fail to load it says so, and Retry brings the projects', async ({ page, data }) => {
  const url = `**/api/v1/orgs/${data.orgId}/workers/${data.worker.membershipId}`;
  await page.route(url, (route) => route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Something went wrong on our side', status: 500, code: 'internal_error' }) }));
  const dialog = await openAddTimeFor(page, data.orgId, data.worker.name);
  await dialog.getByRole('button', { name: 'Choose project and task' }).click();
  // Server errors are retried twice before the list gives up.
  const failed = page.getByRole('alert').filter({ hasText: 'Couldn’t load projects.' });
  await expect(failed).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/not assigned to any active project/)).toHaveCount(0);

  await page.unroute(url);
  await failed.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('option', { name: new RegExp(data.projects.website.name) }).first()).toBeVisible();
});

test('someone with no projects is told plainly, in the member’s words', async ({ page, data }) => {
  // Every list loaded, the member is on none of the projects.
  await page.route(`**/api/v1/orgs/${data.orgId}/workers/${data.worker.membershipId}`, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), team_ids: [] } });
  });
  await page.route(`**/api/v1/orgs/${data.orgId}/projects`, (route) => route.fulfill({ json: [] }));
  const dialog = await openAddTimeFor(page, data.orgId, data.worker.name);
  await dialog.getByRole('button', { name: 'Choose project and task' }).click();
  await expect(page.getByText('This member is not assigned to any active project yet.')).toBeVisible();
});
