import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE } from '../../support/env';
import type { Page } from '@playwright/test';

/**
 * A project's Milestones tab (Performance Center): add, complete, reopen, edit, hide from the client
 * and delete; what is wrong is said; empty, loading and error states; and who cannot see them. The
 * milestone made here is deleted at the end.
 */
const MILESTONES = /\/api\/v1\/orgs\/[^/]+\/projects\/[^/]+\/milestones$/;
const openTab = async (page: Page, orgId: string, projectId: string) => {
  await page.goto(`/o/${orgId}/projects/${projectId}`);
  await page.getByRole('tab', { name: /^Milestones/ }).or(page.getByRole('button', { name: /^Milestones/ })).first().click();
};
const row = (page: Page, title: string) => page.getByRole('listitem').filter({ hasText: title });

test.describe('Project milestones', () => {
  test.use({ storageState: ADMIN_STATE });

  test('add a milestone, mark it done, reopen, edit and hide it from the client, then delete it', { tag: '@smoke' }, async ({ page, data }) => {
    const title = `Beta handed over ${Date.now().toString(36)}`;
    await openTab(page, data.orgId, data.projects.website.id);
    await expect(page.getByText('Milestones are the delivery dates of this project.', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'Add milestone' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add milestone' });
    await dialog.getByRole('button', { name: 'Save milestone' }).click();
    await expect(dialog.getByText('Name the milestone.')).toBeVisible();
    await dialog.getByPlaceholder('For example: Beta handed to the client').fill(title);
    await dialog.getByLabel('Due').fill('2099-06-30');
    await expect(dialog.getByLabel('Show in the client portal')).toBeChecked();
    await dialog.getByRole('button', { name: 'Save milestone' }).click();
    await expect(page.getByText('Milestone added')).toBeVisible();

    const m = row(page, title);
    await expect(m).toContainText('Open');
    await expect(m).toContainText('Client sees it');

    // Done before its due date: on time. Reopened: open again.
    await m.getByRole('checkbox', { name: `Mark ${title} done` }).check();
    await expect(page.getByText(`${title} done`)).toBeVisible();
    await expect(m).toContainText('Done on time');
    // A done milestone keeps its due date: it is part of its record.
    await m.getByRole('button', { name: `Edit: ${title}` }).click();
    const locked = page.getByRole('dialog', { name: 'Edit milestone' });
    await expect(locked.getByLabel('Due')).toBeDisabled();
    await expect(locked.getByText('This milestone is done. Reopen it to change its due date.')).toBeVisible();
    await locked.getByRole('button', { name: 'Cancel' }).click();
    await m.getByRole('checkbox', { name: `Mark ${title} done` }).uncheck();
    await expect(page.getByText(`${title} reopened`)).toBeVisible();
    await expect(m).toContainText('Open');

    // Edit: hide it from the client.
    await m.getByRole('button', { name: `Edit: ${title}` }).click();
    const edit = page.getByRole('dialog', { name: 'Edit milestone' });
    await edit.getByLabel('Show in the client portal').uncheck();
    await edit.getByRole('button', { name: 'Save milestone' }).click();
    await expect(edit).toBeHidden();
    await expect(m).toContainText('Hidden from client');

    await m.getByRole('button', { name: `Delete: ${title}` }).click();
    await page.getByRole('dialog', { name: 'Delete this milestone?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Milestone deleted')).toBeVisible();
    await expect(row(page, title)).toHaveCount(0);
  });

  test('a project without milestones says what to do; loading and failure are explained', async ({ page, data }) => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let mode: 'fail' | 'empty' = 'fail';
    await page.route(MILESTONES, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await held;
      if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ title: 'Something went wrong on our side' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await openTab(page, data.orgId, data.projects.app.id);
    await expect(page.getByRole('status', { name: 'Loading performance' })).toBeVisible();
    release();
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong on our side' }).first()).toBeVisible({ timeout: 15_000 });
    mode = 'empty';
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('No milestones yet')).toBeVisible();
    await expect(page.getByText('Add the dates this project must deliver on.', { exact: false })).toBeVisible();
  });
});

test.describe('Project milestones: who cannot see them', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone who cannot read the project gets nothing from the milestones API', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    const origin = new URL(page.url()).origin;
    expect((await page.request.get(`/api/v1/orgs/${data.orgId}/projects/${data.projects.website.id}/milestones`)).status()).toBe(404);
    expect((await page.request.post(`/api/v1/orgs/${data.orgId}/projects/${data.projects.website.id}/milestones`, { data: { title: 'x', due_date: '2099-01-01' }, headers: { Origin: origin } })).status()).toBe(404);
  });
});
