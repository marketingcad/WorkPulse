import { request } from '@playwright/test';
import { STATE, TUTORIAL_URL } from '../env';
import { expect, label, test } from '../kit';

const isoDay = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

test('06.1', async ({ d, page }) => {
  await d.go('');
  d.begin();
  const nav = page.getByRole('complementary', { name: 'Primary' });
  const group = nav.getByRole('button', { name: 'Project Management' });
  await d.point(group, { hold: 1200, on: 'Open Project Management' });
  if ((await group.getAttribute('aria-expanded')) !== 'true') await d.click(group, { settle: false });
  await d.click(nav.getByRole('link', { name: 'Clients' }));
  await d.click(page.getByRole('button', { name: 'New client' }), { settle: false });
  const dialog = page.getByRole('dialog', { name: 'New client' });
  await d.mark('zoom to the New client dialog', dialog, { on: 'click New client' });
  await d.type(dialog.getByLabel('Company / client name'), 'Lumen Outdoor Co.');
  await d.type(dialog.getByLabel('Contact person'), 'Rosa Diaz', { on: 'a contact person' });
  await d.type(dialog.getByLabel('Contact email'), 'billing@lumen.example', { on: 'The contact email' });
  await d.point(dialog.getByLabel('Currency'), { hold: 1500 });
  await d.type(dialog.getByLabel('Bill rate per hour'), '120');
  await d.click(dialog.getByRole('button', { name: 'Create client' }), { on: 'Click Create client' });
  await expect(dialog).toBeHidden();
  await d.finish();
});

test('06.2', async ({ d, page }) => {
  // The duplicate the scene deletes: created by mistake, never used.
  const admin = await request.newContext({ baseURL: TUTORIAL_URL, storageState: STATE.admin, extraHTTPHeaders: { Origin: TUTORIAL_URL } });
  const dup = await admin.post(`/api/v1/orgs/${d.data.orgId}/clients`, { data: { name: 'Lumen Outdoor', currency: 'USD' } });
  expect(dup.ok(), await dup.text()).toBe(true);
  await admin.dispose();

  await d.go('/clients');
  d.begin();
  await d.type(page.getByPlaceholder('Search clients…'), 'Lumen');
  await d.settle();
  await d.beat(2000);
  await d.click(page.getByRole('button', { name: 'Actions for Lumen Outdoor', exact: true }), { settle: false });
  await d.click(page.getByRole('menuitem', { name: 'Delete' }), { settle: false, on: 'choose Delete' });
  const dialog = page.getByRole('dialog', { name: 'Delete Lumen Outdoor?' });
  await d.mark('zoom to the delete confirmation', dialog, { on: 'WorkPulse explains what will be removed' });
  await d.point(dialog.getByText(/permanently deletes/), { hold: 6000 });
  await d.click(dialog.getByRole('button', { name: 'Delete client' }));
  await expect(page.getByText('Lumen Outdoor deleted')).toBeVisible();
  await d.beat(1500);
  await d.type(page.getByPlaceholder('Search clients…'), 'Vandelay');
  await d.settle();
  await d.click(page.getByRole('button', { name: 'Actions for Vandelay Imports' }), { settle: false });
  const archive = page.getByRole('menuitem', { name: 'Archive' });
  await d.mark('highlight Archive', archive, { on: 'use Archive instead' });
  await d.point(archive, { hold: 4000 });
  await page.keyboard.press('Escape');
  await d.point(page.getByLabel('Show archived'), { hold: 2000, on: 'Tick Show archived' });
  await d.finish();
});

test('06.3', async ({ d, page }) => {
  await d.go('/clients');
  d.begin();
  await d.click(page.getByRole('button', { name: 'Actions for Globex Retail' }), { settle: false, on: 'in a client portal' });
  await d.click(page.getByRole('menuitem', { name: 'Client portal' }), { on: 'open Client portal' });
  await expect(page.getByRole('heading', { level: 1, name: /Globex Retail — Client portal/ })).toBeVisible();
  const on = page.getByLabel('Portal on');
  if (!(await on.isChecked())) await d.click(on, { settle: false, on: 'Switch the portal on' });
  else await d.point(on, { hold: 1200, on: 'Switch the portal on' });
  const sees = page.getByLabel('Hours per person, task and day');
  await d.mark('zoom to What the client sees', sees, { on: 'choose what the client sees' });
  for (const label of ['Hours per person, task and day', 'Task progress and hour budgets', 'Activity level of each person', 'Screenshots taken on this client’s projects']) await d.point(page.getByLabel(label), { hold: 1100 });
  const ai = page.getByLabel('A short summary written by WorkPulse AI');
  await d.point(ai, { hold: 600, on: 'a short summary written by WorkPulse AI' });
  if (!(await ai.isChecked())) await d.click(ai, { settle: false });
  await d.beat(2500);
  const preview = page.getByRole('button', { name: 'Preview as client' });
  await d.click(preview);
  await d.mark('zoom to the preview', page.getByRole('heading', { level: 2, name: 'Globex Retail' }).first(), { on: 'Click Preview as client' });
  await d.beat(4000);
  await d.click(preview);
  const email = page.getByLabel(label('Email'));
  await d.scrollTo(email);
  await d.type(email, 'cto@globex.example', { on: 'enter their email' });
  await d.click(page.getByRole('button', { name: 'Invite', exact: true }), { on: 'click Invite' });
  await d.finish();
});

test('06.4', async ({ d, page }) => {
  await d.go('/clients');
  d.begin();
  await d.click(page.getByRole('complementary', { name: 'Primary' }).getByRole('link', { name: 'Projects' }));
  await d.click(page.getByRole('button', { name: 'New project' }), { settle: false });
  const dialog = page.getByRole('dialog', { name: 'New project' });
  await d.mark('zoom to the New project dialog', dialog, { on: 'click New project' });
  await d.type(dialog.getByLabel(label('Name')), 'Lumen — Spring Campaign');
  await d.choose(dialog.getByLabel(label('Client')), 'Lumen Outdoor Co.');
  await d.set(dialog.getByLabel('Start date'), isoDay(3));
  await d.set(dialog.getByLabel('End date'), isoDay(60));
  await d.type(dialog.getByLabel('Estimated hours'), '120');
  await d.click(dialog.getByRole('button', { name: 'Teams' }), { settle: false, on: 'whole teams' });
  await d.click(page.getByRole('option', { name: 'Design' }).getByRole('checkbox'), { settle: false });
  await page.keyboard.press('Escape');
  const bill = dialog.getByLabel('Bill rate per hour');
  await d.scrollTo(bill, { on: 'In the finance section' });
  await d.point(bill, { hold: 2500 });
  await d.click(dialog.getByRole('button', { name: 'Create project' }), { on: 'Click Create project' });
  await expect(dialog).toBeHidden();
  await d.finish();
});

test('06.5', async ({ d, page }) => {
  await d.go('/projects');
  d.begin();
  await d.click(page.getByText('Globex — Website Redesign', { exact: true }).first());
  await d.click(page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Settings', exact: true }), { on: 'go to its Settings tab' });
  const breaks = page.getByRole('region', { name: 'Breaks' });
  await d.scrollTo(breaks);
  await d.mark('zoom to the Breaks section', breaks, { on: 'In the Breaks section' });
  const plan = [
    { n: 1, type: 'Coffee', time: '10:30', minutes: '15' },
    { n: 2, type: 'Lunch', time: '12:00', minutes: '60' },
  ];
  for (const b of plan) {
    await d.click(breaks.getByRole('button', { name: 'Add break' }), b.n === 1 ? { settle: false, on: 'click Add break' } : { settle: false });
    await d.choose(breaks.getByLabel(`Break ${b.n} type`), b.type);
    await d.set(breaks.getByLabel(`Break ${b.n} time`), b.time);
    await d.type(breaks.getByLabel(`Break ${b.n} minutes`), b.minutes);
  }
  await d.click(page.getByRole('button', { name: 'Save changes' }), { settle: false, on: 'Click Save changes' });
  await expect(page.getByText('Project saved')).toBeVisible();
  await d.finish();
});

test('06.6', async ({ d, page }) => {
  await d.go('/projects');
  d.begin();
  await d.click(page.getByRole('complementary', { name: 'Primary' }).getByRole('link', { name: 'Tasks' }));
  await d.click(page.getByRole('button', { name: 'New task' }), { settle: false });
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await d.mark('zoom to the New task dialog', dialog, { on: 'click New task' });
  await d.choose(dialog.getByLabel(label('Project')), 'Lumen — Spring Campaign');
  await d.type(dialog.getByLabel('Title'), 'Campaign moodboard');
  await d.choose(dialog.getByLabel('Priority'), 'High');
  await d.set(dialog.getByLabel('Due date'), isoDay(10));
  await d.type(dialog.getByLabel('Estimate (hours)'), '6');
  await d.click(dialog.getByRole('button', { name: 'Assignees' }), { settle: false });
  await d.click(page.getByRole('option', { name: /Ava Okafor/ }).getByRole('checkbox'), { settle: false });
  await page.keyboard.press('Escape');
  await d.click(dialog.getByRole('button', { name: 'Create task' }));
  await expect(dialog).toBeHidden();
  await d.finish();
});
