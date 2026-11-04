import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { request, type Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE, WEB_URL, WORKER_STATE } from '../../support/env';

/**
 * UX remediation, phase 3: nobody finishes an important action wondering what to do next. Covers the
 * sidebar and Settings navigation, filters that survive refresh, Back and shared links, the top-bar
 * Help, next steps after actions, confirmations that say what will happen, and managers' "Time not added".
 */
test.use({ storageState: ADMIN_STATE });

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Primary' });

test.describe('navigation', () => {
  test('sidebar groups start open, remember being closed, and list the person’s own pages', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    // Open without clicking anything (they used to start closed on Overview).
    await expect(sidebar(page).getByRole('link', { name: 'Time entries' })).toBeVisible();
    await expect(sidebar(page).getByRole('link', { name: 'Members' })).toBeVisible();
    await expect(sidebar(page).getByRole('link', { name: 'My timesheet' })).toBeVisible();
    await expect(sidebar(page).getByRole('link', { name: 'What is monitored' })).toBeVisible();
    const money = sidebar(page).getByRole('button', { name: 'Finance' });
    await expect(money).toHaveAttribute('aria-expanded', 'true');
    await money.click();
    await expect(money).toHaveAttribute('aria-expanded', 'false');
    await page.reload();
    await expect(money).toHaveAttribute('aria-expanded', 'false');
    await money.click();
    await expect(money).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar(page).getByRole('link', { name: 'Invoices' })).toBeVisible();
  });

  test('Settings shows every section under its topic, and a list of them on a phone', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings`);
    const nav = page.getByRole('navigation', { name: 'Settings' });
    for (const [group, items] of [
      ['General', ['Organization']],
      ['Time and attendance', ['Time & pay', 'Tracking policies']],
      ['People and access', ['Roles & permissions', 'Access review', 'Devices']],
      ['Data and privacy', ['Security & retention', 'Screenshot retention', 'Audit log']],
      ['Integrations', ['API keys', 'Webhooks']],
    ] as const) {
      const g = nav.getByRole('group', { name: group });
      for (const item of items) await expect(g.getByRole('link', { name: item })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Organization' })).toHaveAttribute('aria-current', 'page');
    expect((await new AxeBuilder({ page }).include('main nav').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel('Settings section').selectOption({ label: 'Audit log' });
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/settings/audit$`));
    await expect(page.getByLabel('Settings section')).toHaveValue('/settings/audit');
  });

  test('the top bar Help opens this page’s guide, once, and not on Help itself', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/timesheets/all`);
    await expect(page.getByRole('link', { name: 'Help for this page' })).toHaveCount(1);
    await page.getByRole('link', { name: 'Help for this page' }).click();
    await expect(page).toHaveURL(/\/help#correct-time$/);
    await expect(page.getByRole('link', { name: 'Help for this page' })).toHaveCount(0);
  });
});

test.describe('filters survive refresh, Back and shared links', () => {
  test('Sessions keeps its range and search in the address', { tag: '@smoke' }, async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/sessions`);
    await page.getByLabel('Date range').selectOption('last_week');
    await page.getByLabel('Search sessions').fill('website');
    await expect(page).toHaveURL(/range=last_week/);
    await expect(page).toHaveURL(/q=website/);
    await page.reload();
    await expect(page.getByLabel('Date range')).toHaveValue('last_week');
    await expect(page.getByLabel('Search sessions')).toHaveValue('website');
    // Away and Back: the list is as it was left.
    await page.goto(`/o/${data.orgId}/clients`);
    await page.goBack();
    await expect(page.getByLabel('Date range')).toHaveValue('last_week');
    await expect(page.getByLabel('Search sessions')).toHaveValue('website');
  });

  test('a link with broken or outdated values opens with the defaults, not an error', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/sessions?range=next_century&from=2026-99-99&to=nope&member=not-an-id`);
    await expect(page.getByRole('heading', { level: 1, name: 'Sessions' })).toBeVisible();
    await expect(page.getByLabel('Date range')).toHaveValue('this_week');
    await expect(page.getByRole('alert').filter({ hasText: /error|invalid/i })).toHaveCount(0);
    await page.goto(`/o/${data.orgId}/timesheets/all?project=not-an-id&range=bogus`);
    await expect(page.getByRole('heading', { level: 1, name: 'Time entries' })).toBeVisible();
    await expect(page.getByLabel('Project', { exact: true })).toHaveValue('');
  });

  test('Attendance, Time entries and Time off reopen the same view from a link', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/attendance?view=week&status=LATE`);
    await expect(page.getByLabel('Status')).toHaveValue('LATE');
    await expect(page.getByRole('radio', { name: 'Week' })).toBeChecked();
    await page.goto(`/o/${data.orgId}/timesheets/all?project=${data.projects.website.id}`);
    await expect(page.getByLabel('Project', { exact: true })).toHaveValue(data.projects.website.id);
    await page.goto(`/o/${data.orgId}/time-off`);
    await page.getByRole('button', { name: 'Calendar' }).click();
    await expect(page).toHaveURL(/tab=calendar/);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Calendar' })).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('next steps after an action', () => {
  test('a new client offers to add its first project, on that client', async ({ page, data }) => {
    const name = `Next step client ${uid()}`;
    await page.goto(`/o/${data.orgId}/clients`);
    await page.getByRole('button', { name: 'New client' }).first().click();
    await page.getByRole('dialog', { name: 'New client' }).getByLabel('Company / client name').fill(name);
    await page.getByRole('dialog', { name: 'New client' }).getByRole('button', { name: 'Create client' }).click();
    await page.getByRole('button', { name: 'Add a project' }).click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Client', { exact: true })).toHaveValue(/.+/);
    await expect(dialog.getByLabel('Client', { exact: true }).locator('option:checked')).toHaveText(name);
  });

  test('an invitation says what happens next, with the download page', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/workers`);
    await page.getByRole('button', { name: 'Invite member' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Invite member' });
    await dialog.getByLabel('Email').fill(`next-${uid()}@e2e.test`);
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    const next = page.getByRole('dialog', { name: 'Invitation ready' }).getByRole('region', { name: 'What happens next' });
    await expect(next).toContainText('They install the desktop app');
    await expect(next).toContainText('Tallywork');
    await expect(next.getByRole('link', { name: /\/download$/ })).toBeVisible();
  });

  test('a member’s profile offers to add them to a project, and links to Devices', async ({ page, data, adminApi }) => {
    const project = await ok<{ id: string; name: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Profile add ${uid()}` } }), 'project');
    await page.goto(`/o/${data.orgId}/workers/${data.newcomer.membershipId}?tab=projects`);
    await page.getByLabel('Project to add this member to').selectOption({ label: project.name });
    await page.getByRole('button', { name: 'Add to project' }).click();
    await expect(page.getByText(`was added to ${project.name}`)).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(project.name) })).toBeVisible();
    await page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Devices' }).click();
    await expect(page).toHaveURL(/tab=devices/);
    await expect(page.getByRole('link', { name: 'Manage on Devices' })).toHaveAttribute('href', `/o/${data.orgId}/devices`);
  });

  test('Devices links to the download page instead of telling admins to ask their administrator', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/devices`);
    await expect(page.getByRole('link', { name: 'Open the download page' })).toHaveAttribute('href', '/download');
    await expect(page.getByText('Ask your administrator for the installer')).toHaveCount(0);
  });

  test('an outdated report link explains itself and leads back to the library', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/reports/no-such-report`);
    await expect(page.getByRole('heading', { name: 'Report not available' })).toBeVisible();
    await page.getByRole('link', { name: 'Open the Report library' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/reports$`));
  });
});

test.describe('confirmations say what will happen', () => {
  test('removing someone from a team names what they lose, and Cancel keeps them', async ({ page, data, adminApi }) => {
    const team = await ok<{ id: string; name: string }>(await adminApi.api.post(adminApi.orgApi('/teams'), { data: { name: `Confirm team ${uid()}` } }), 'team');
    await ok(await adminApi.api.put(adminApi.orgApi(`/teams/${team.id}/members/${data.newcomer.membershipId}`), { data: { role: 'MEMBER' } }), 'member');
    await page.goto(`/o/${data.orgId}/teams`);
    await page.getByRole('row', { name: new RegExp(team.name) }).click();
    await page.getByRole('button', { name: `Remove ${data.newcomer.name} from team` }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: `Remove ${data.newcomer.name} from ${team.name}?` }));
    await expect(dialog.first()).toContainText('Their tracked time is kept');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: `Remove ${data.newcomer.name} from team` })).toBeVisible();
    await page.getByRole('button', { name: `Remove ${data.newcomer.name} from team` }).click();
    await page.getByRole('button', { name: 'Remove from team' }).click();
    await expect(page.getByRole('button', { name: `Remove ${data.newcomer.name} from team` })).toHaveCount(0);
  });

  test('unticking Active on a client says it archives its projects, on the button too', async ({ page, data, adminApi }) => {
    const name = `Active client ${uid()}`;
    await ok(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name } }), 'client');
    await page.goto(`/o/${data.orgId}/clients`);
    await page.getByRole('row', { name: new RegExp(name) }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit client' });
    await dialog.getByRole('checkbox', { name: 'Active' }).uncheck();
    await expect(dialog.getByRole('alert')).toContainText(`Saving archives ${name}`);
    await expect(dialog.getByRole('button', { name: 'Archive client and its projects' })).toBeVisible();
  });

  test('tracking policy: switching member asks before discarding, and Save lists what changes', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings/policies`);
    await page.getByRole('radio', { name: 'Member' }).click();
    await page.getByLabel('Member', { exact: true }).selectOption({ label: data.newcomer.name });
    await page.getByRole('switch', { name: 'Capture screenshots' }).first().click();
    await page.getByLabel('Member', { exact: true }).selectOption({ label: data.worker.name });
    await expect(page.getByRole('heading', { name: 'Discard unsaved policy changes?' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Member', { exact: true }).locator('option:checked')).toHaveText(data.newcomer.name);

    await page.getByRole('button', { name: 'Save policy' }).click();
    await expect(page.getByRole('heading', { name: `Save the ${data.newcomer.name} policy?` })).toBeVisible();
    await expect(page.getByText(`Only ${data.newcomer.name} is affected`)).toBeVisible();
    await expect(page.getByText(/Capture screenshots: .* → /)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click(); // not saved: the shared fixture stays as it is
  });

  test('requiring two-factor for everyone says who is not ready (cancelled here)', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings/security`);
    await page.getByLabel(/two-factor/i).first().selectOption('all');
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByRole('heading', { name: 'Save these sign-in rules?' })).toBeVisible();
    await expect(page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'Save these sign-in rules?' }).getByText(/cannot use the organization until it is on/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('rejecting an expense explains it first', async ({ page, data }) => {
    const worker = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    const category = `Taxi ${uid()}`;
    await ok(await worker.post(`/api/v1/orgs/${data.orgId}/expenses`, { data: { category, amount_minor: 4200, currency: 'USD', spent_on: new Date().toISOString().slice(0, 10) } }), 'expense');
    await worker.dispose();
    await page.goto(`/o/${data.orgId}/finance/expenses`);
    await page.getByRole('row', { name: new RegExp(category) }).getByRole('button', { name: 'Reject' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'You can still approve it later' });
    // A reason is required, and an empty one is refused with a message (never silently).
    await dialog.getByRole('button', { name: 'Reject expense' }).click();
    await expect(dialog.getByText('Write a reason of at least 3 characters.')).toBeVisible();
    await dialog.getByLabel('Reason').fill('No receipt attached: add it and submit again.');
    await dialog.getByRole('button', { name: 'Reject expense' }).click();
    const row = page.getByRole('row', { name: new RegExp(category) });
    await expect(row).toContainText(/Rejected/i);
    await expect(row).toContainText('“No receipt attached: add it and submit again.”');

    // The member sees the reason on their own expenses (through the API here: workers use the desktop app).
    const own = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    const list = await ok<{ data: Array<{ category: string; rejection_reason: string | null }> }>(await own.get(`/api/v1/orgs/${data.orgId}/expenses?page=1&page_size=100`), 'own expenses');
    expect(list.data.find((x) => x.category === category)?.rejection_reason).toBe('No receipt attached: add it and submit again.');
    await own.dispose();
  });

  test('a role still held cannot be deleted, and says why', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings/roles`);
    const del = page.getByRole('button', { name: /Budget viewer .* cannot be deleted/ });
    await expect(del).toBeDisabled();
    // Permissions read as what they allow, not as raw keys.
    await expect(page.getByText('Invite, change and remove members')).toBeVisible();
    await expect(page.getByText('members:manage', { exact: true })).toHaveCount(0);
  });
});

test.describe('Time not added (managers)', () => {
  test('lists refused offline time with why and where it stands, through to a correction', { tag: '@smoke' }, async ({ page, data, adminApi, workerDevice }) => {
    // A project the worker is not on: their offline session on it is refused when it arrives.
    const project = await ok<{ id: string; name: string }>(await adminApi.api.post(adminApi.orgApi('/projects'), { data: { name: `Refused ${uid()}` } }), 'project');
    const agent = await request.newContext({ baseURL: WEB_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { Authorization: `Bearer ${workerDevice.token}` } });
    const sid = randomUUID();
    const start = Date.now() - 3 * 3600_000;
    const at = (min: number) => new Date(start + min * 60_000).toISOString();
    const r = await ok<{ results: Array<{ status: string }> }>(
      await agent.post('/api/v1/agent/ingest/batch', {
        data: { sent_at: new Date().toISOString(), events: [{ event_id: randomUUID(), type: 'session.start', session_id: sid, seq: 1, occurred_at: at(0), project_id: project.id }, { event_id: randomUUID(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: at(45) }] },
      }),
      'ingest',
    );
    expect(r.results.map((x) => x.status)).toEqual(['rejected', 'rejected']);

    await page.goto(`/o/${data.orgId}/timesheets/not-added`);
    await expect(page.getByRole('navigation', { name: 'Timesheets' }).getByRole('link', { name: 'Time not added' })).toHaveAttribute('aria-current', 'page');
    const row = page.getByRole('row').filter({ hasText: project.name });
    await expect(row).toContainText(data.worker.name);
    await expect(row).toContainText('The member is no longer on this project.');
    await expect(row).toContainText('Not resolved');
    await expect(row).toContainText('45m');
    expect((await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);

    // The worker asks for it as manual time (from the desktop app): it waits for approval, linked.
    const req = await ok<{ results: Array<{ status: string }> }>(
      await agent.post('/api/v1/agent/ingest/batch', {
        data: { sent_at: new Date().toISOString(), events: [{ event_id: randomUUID(), type: 'manual_time.request', occurred_at: new Date().toISOString(), project_id: data.projects.website.id, started_at: at(0), ended_at: at(45), reason: `Offline, project was mine ${uid()}`, refused_session_id: sid }] },
      }),
      'correction',
    );
    expect(req.results[0]!.status).toBe('accepted');
    await agent.dispose();
    await page.reload();
    await expect(row).toContainText('Waiting for approval');
    await expect(row).toContainText('Member’s reason');
    await row.getByRole('link', { name: 'Review request' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/timesheets/approvals$`));
  });

  test('is not offered to someone who may not see tracked time', async ({ browser, data }) => {
    const ctx = await browser.newContext({ storageState: VIEWER_STATE });
    const page = await ctx.newPage();
    await page.goto(`/o/${data.orgId}/timesheets/not-added`);
    await expect(page.getByRole('row').filter({ hasText: 'Not resolved' })).toHaveCount(0);
    await expect(page.getByText(/You don.t have access|restricted|no access/i).first()).toBeVisible();
    await ctx.close();
  });
});
