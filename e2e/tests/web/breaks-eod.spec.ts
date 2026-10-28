import { randomUUID } from 'node:crypto';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * Planned breaks on a project (Coffee 10:30 for 15 min, Lunch 12:00…), which the desktop app shows
 * as break buttons, and the end-of-day reports workers write when they clock out.
 */

test.describe('Project breaks', () => {
  test.use({ storageState: ADMIN_STATE });

  test('an admin plans Coffee and Lunch breaks on a new project, then edits them', { tag: '@smoke' }, async ({ page, data, adminApi }) => {
    const run = uid();
    const coffee = `Coffee ${run}`;
    const lunch = `Lunch ${run}`;
    await ok(await adminApi.api.post(adminApi.orgApi('/break-types'), { data: { name: coffee, paid: true, max_minutes: 15 } }), 'coffee');
    await ok(await adminApi.api.post(adminApi.orgApi('/break-types'), { data: { name: lunch, paid: false, max_minutes: 60 } }), 'lunch');
    const name = `Help desk ${run}`;

    await page.goto(`/o/${data.orgId}/projects`);
    await page.getByRole('button', { name: 'New project' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(name);
    const breaks = dialog.getByRole('region', { name: 'Breaks' });
    await expect(breaks).toContainText('No breaks planned');

    await breaks.getByRole('button', { name: 'Add break' }).click();
    await breaks.getByLabel('Break 1 type').selectOption({ label: `${coffee} (paid)` });
    await breaks.getByLabel('Break 1 time').fill('10:30');
    await expect(breaks.getByLabel('Break 1 minutes')).toHaveAttribute('placeholder', '15');
    await breaks.getByRole('button', { name: 'Add break' }).click();
    await breaks.getByLabel('Break 2 type').selectOption({ label: `${lunch} (unpaid)` });
    await breaks.getByLabel('Break 2 time').fill('12:00');
    await breaks.getByLabel('Break 2 minutes').fill('45');
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByText('Project created')).toBeVisible();

    const created = (await ok<Array<{ id: string; name: string; breaks: Array<{ name: string; start_time: string; duration_minutes: number }> }>>(await adminApi.api.get(adminApi.orgApi('/projects')), 'projects')).find((p) => p.name === name)!;
    expect(created.breaks.map((b) => [b.name, b.start_time, b.duration_minutes])).toEqual([
      [coffee, '10:30', 15],
      [lunch, '12:00', 45],
    ]);

    // Edit on the project's Settings tab: drop the coffee break.
    await page.goto(`/o/${data.orgId}/projects/${created.id}`);
    await page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('region', { name: 'Breaks' });
    await expect(settings.getByLabel('Break 2 time')).toHaveValue('12:00');
    await settings.getByRole('button', { name: 'Remove break 1' }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Project saved')).toBeVisible();
    await page.reload();
    await page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(settings.getByLabel('Break 1 type')).toHaveValue(/.+/);
    await expect(settings.getByLabel('Break 2 type')).toHaveCount(0);
    await expect(settings.getByLabel('Break 1 time')).toHaveValue('12:00');
  });

  test('a break length outside 1–480 minutes is refused and nothing is created', async ({ page, data, adminApi }) => {
    const run = uid();
    await ok(await adminApi.api.post(adminApi.orgApi('/break-types'), { data: { name: `Stretch ${run}`, paid: true } }), 'stretch');
    const name = `Bad break ${run}`;
    await page.goto(`/o/${data.orgId}/projects`);
    await page.getByRole('button', { name: 'New project' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByRole('textbox', { name: /^Name/ }).fill(name);
    const breaks = dialog.getByRole('region', { name: 'Breaks' });
    await breaks.getByRole('button', { name: 'Add break' }).click();
    await breaks.getByLabel('Break 1 type').selectOption({ label: `Stretch ${run} (paid)` });
    await breaks.getByLabel('Break 1 minutes').fill('0');
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(breaks.getByText('Whole minutes, 1 to 480')).toBeVisible();
    await expect(dialog).toBeVisible();
    const all = await ok<Array<{ name: string }>>(await adminApi.api.get(adminApi.orgApi('/projects')), 'projects');
    expect(all.some((p) => p.name === name)).toBe(false);
  });
});

test.describe('End-of-day reports', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a manager reads what a worker completed, with the session’s time, and can show finished work only', { tag: '@smoke' }, async ({ page, data, newcomerDevice }) => {
    // The newcomer clocks in and out in the desktop app (its events, sent as the app sends them).
    const send = async (events: unknown[]) => {
      const res = await fetch(`${WEB_URL}/api/v1/agent/ingest/batch`, { method: 'POST', headers: { Authorization: `Bearer ${newcomerDevice.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sent_at: new Date().toISOString(), events }) });
      expect(res.status).toBe(200);
    };
    const report = `Answered the support inbox ${uid()}`;
    const sid = randomUUID();
    const start = new Date(Date.now() - 90 * 60_000).toISOString();
    await send([{ event_id: randomUUID(), type: 'session.start', session_id: sid, seq: 1, occurred_at: start, project_id: data.projects.website.id }]);
    await send([{ event_id: randomUUID(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: new Date().toISOString(), report: { text: report, finished: true } }]);

    await page.goto(`/o/${data.orgId}/tracking/reports`);
    await expect(page.getByRole('heading', { level: 1, name: 'End-of-day reports' })).toBeVisible();
    const card = page.getByRole('article').filter({ hasText: report });
    await expect(card).toContainText(data.newcomer.name);
    await expect(card).toContainText(data.projects.website.name);
    await expect(card).toContainText('Finished');
    await expect(card).toContainText('1h 30m');

    await page.getByLabel('Show').selectOption('finished');
    await expect(card).toBeVisible();
    await page.getByLabel('Member').selectOption({ label: data.newcomer.name });
    await expect(card).toBeVisible();
    // A period with no reports: the empty state.
    await page.getByLabel('Show').selectOption('all');
    // A week a few months ahead (the filter keeps ranges under 400 days, so move the end first).
    const ahead = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
    await page.getByLabel('To date').fill(ahead(97));
    await page.getByLabel('From date').fill(ahead(90));
    await expect(page.getByText('No end-of-day reports in this period')).toBeVisible();
  });

  test('reports are grouped by day, previewed on cards, and read in full in a dialog that pages through them', { tag: '@smoke' }, async ({ page, context, data, newcomerDevice }) => {
    const send = async (events: unknown[]) => {
      const res = await fetch(`${WEB_URL}/api/v1/agent/ingest/batch`, { method: 'POST', headers: { Authorization: `Bearer ${newcomerDevice.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sent_at: new Date().toISOString(), events }) });
      expect(res.status).toBe(200);
    };
    const tag = uid();
    const lines = [`Release notes ${tag}`, 'Fixed the login redirect.', 'Reviewed two pull requests.', 'Paired with Sam on the export.', 'Wrote the onboarding guide.', 'Last line only in the dialog.'];
    for (const [i, text] of [lines.join('\n'), `Short update ${tag}`].entries()) {
      const sid = randomUUID();
      await send([{ event_id: randomUUID(), type: 'session.start', session_id: sid, seq: 1, occurred_at: new Date(Date.now() - (60 - i * 20) * 60_000).toISOString(), project_id: data.projects.website.id }]);
      await send([{ event_id: randomUUID(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: new Date(Date.now() - (30 - i * 20) * 60_000).toISOString(), report: { text, finished: i === 1 } }]);
    }

    await page.goto(`/o/${data.orgId}/tracking/reports`);
    // Summary numbers, and a heading per day.
    await expect(page.getByText('Reports', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('People reporting')).toBeVisible();
    // (The test organization and the browser use UTC.)
    await expect(page.getByRole('heading', { level: 2, name: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) })).toBeVisible();

    // Search narrows the cards to the ones that mention the words.
    await test.info().attach('eod-reports', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByLabel('Search reports').fill(tag);
    const cards = page.getByRole('article');
    await expect(cards).toHaveCount(2);
    const long = cards.filter({ hasText: `Release notes ${tag}` });
    await expect(long).toContainText(data.projects.website.name);

    // The full report, with its details, in a dialog.
    await long.getByRole('button', { name: `Read full report from ${data.newcomer.name}` }).click();
    const dialog = page.getByRole('dialog', { name: data.newcomer.name });
    await expect(dialog).toContainText('End-of-day report');
    await expect(dialog.getByRole('region', { name: 'Report' })).toContainText('Last line only in the dialog.');
    await test.info().attach('eod-report-dialog', { body: await page.screenshot(), contentType: 'image/png' });
    await expect(dialog).toContainText('30m');
    await expect(dialog).toContainText(/1 of 2|2 of 2/);
    const first = (await dialog.textContent())!.includes('1 of 2');
    await dialog.getByRole('button', { name: first ? 'Next report' : 'Previous report' }).click();
    await expect(dialog.getByRole('region', { name: 'Report' })).toContainText(`Short update ${tag}`);
    await expect(dialog).toContainText('Finished: the person marked this work as complete');

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await dialog.getByRole('button', { name: 'Copy report' }).click();
    await expect(page.getByText('Report copied')).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'View activity for this day' })).toHaveAttribute('href', new RegExp(`/o/${data.orgId}/activity\\?member=${data.newcomer.membershipId}&date=`));
    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(dialog).toBeHidden();

    await page.getByLabel('Search reports').fill(`nothing-like-this-${tag}`);
    await expect(page.getByText(`No reports mention “nothing-like-this-${tag}”`)).toBeVisible();
  });

  test('is in the Time Tracking menu for managers', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    const nav = page.getByRole('complementary', { name: 'Primary' });
    const group = nav.getByRole('button', { name: 'Time Tracking' });
    if ((await group.getAttribute('aria-expanded')) === 'false') await group.click();
    await nav.getByRole('link', { name: 'End-of-day reports' }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/tracking/reports$`));
  });
});

test.describe('End-of-day reports permissions', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone without tracking access sees neither the page nor the reports', async ({ page, data, request }) => {
    await page.goto(`/o/${data.orgId}/tracking/reports`);
    await expect(page.getByRole('heading', { level: 1, name: 'End-of-day reports' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'End-of-day reports' })).toHaveCount(0);
    const today = new Date().toISOString().slice(0, 10);
    const res = await request.get(`/api/v1/orgs/${data.orgId}/eod-reports?from=${today}&to=${today}`, { headers: { Origin: WEB_URL } });
    expect(res.status()).toBe(403);
  });
});
