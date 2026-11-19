import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE } from '../../support/env';

/**
 * Teams (QA pass, feature 4). Creating a team and adding a manager is covered by qa/people-flows; this
 * spec covers the rest of a team's life: changing a role, removing someone, renaming and archiving.
 *
 * BUG-38: an archived team could still be given members, who then regained its projects; and it still
 * showed on its projects.
 */
type Team = { id: string; name: string; members: Array<{ membership_id: string; role: string }> };

test.describe('An admin', () => {
  test.use({ storageState: ADMIN_STATE });

  test('changes a role, removes a member, renames and archives a team', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const { api, orgApi } = adminApi;
    const name = `Team ${uid()}`;
    const team = await ok<{ id: string }>(await api.post(orgApi('/teams'), { data: { name } }), 'team');
    const project = await ok<{ id: string }>(await api.post(orgApi('/projects'), { data: { name: `${name} project`, team_ids: [team.id] } }), 'project');
    await ok(await api.put(orgApi(`/teams/${team.id}/members/${data.worker.membershipId}`), { data: { role: 'MEMBER' } }), 'add worker');
    await ok(await api.put(orgApi(`/teams/${team.id}/members/${data.newcomer.membershipId}`), { data: { role: 'MEMBER' } }), 'add newcomer');

    await page.goto(`/o/${data.orgId}/teams`);
    await page.getByRole('row', { name: new RegExp(name) }).click();
    const drawer = page.getByRole('dialog', { name });

    // Role change.
    await drawer.getByLabel(`Team role for ${data.worker.name}`).selectOption('MANAGER');
    await expect.poll(async () => (await ok<Team[]>(await api.get(orgApi('/teams')), 'teams')).find((t) => t.id === team.id)?.members.find((m) => m.membership_id === data.worker.membershipId)?.role).toBe('MANAGER');

    // Removing asks first.
    await drawer.getByRole('button', { name: `Remove ${data.newcomer.name} from team` }).click();
    const confirmRemove = page.getByRole('dialog', { name: `Remove ${data.newcomer.name} from ${name}?` });
    await confirmRemove.getByRole('button', { name: 'Remove from team' }).click();
    await expect(drawer.getByLabel(`Team role for ${data.newcomer.name}`)).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Rename: a blank name can't be saved.
    const renamed = `${name} renamed`;
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    const dialog = page.getByRole('dialog', { name: 'Rename team' });
    await dialog.getByLabel(/^Name/).fill('   ');
    await expect(dialog.getByRole('button', { name: /^Save/ })).toBeDisabled();
    await dialog.getByLabel(/^Name/).fill(renamed);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByText('Team updated')).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(renamed) })).toBeVisible();

    // Archive asks first, then the team is gone from the list and from its project.
    await page.getByRole('button', { name: `Actions for ${renamed}` }).click();
    await page.getByRole('menuitem', { name: 'Archive team' }).click();
    await page.getByRole('dialog', { name: `Archive ${renamed}?` }).getByRole('button', { name: 'Archive team' }).click();
    await expect(page.getByText('Team archived')).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(renamed) })).toHaveCount(0);

    const p = await ok<{ team_ids?: string[] }>(await api.get(orgApi(`/projects/${project.id}`)), 'project after');
    expect(p.team_ids ?? []).not.toContain(team.id);
    // BUG-38: nobody can be put back on it.
    expect((await api.put(orgApi(`/teams/${team.id}/members/${data.worker.membershipId}`), { data: { role: 'MEMBER' } })).status()).toBe(404);
  });
});

test.describe('A team manager', () => {
  test.use({ storageState: MANAGER_STATE });

  test('sees their teams but can’t create, rename or archive one', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/teams`);
    await expect(page.getByRole('heading', { level: 1, name: 'Teams' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New team' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Actions for / })).toHaveCount(0);
    const res = await page.request.post(`/api/v1/orgs/${data.orgId}/teams`, { data: { name: `Not allowed ${uid()}` }, headers: { Origin: new URL(page.url()).origin } });
    expect(res.status()).toBe(403);
  });
});
