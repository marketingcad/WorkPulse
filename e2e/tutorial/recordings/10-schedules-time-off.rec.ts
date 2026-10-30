import { choice, expect, test } from '../kit';

test('10.1', async ({ d, page }) => {
  await d.go('');
  d.begin();
  const nav = page.getByRole('complementary', { name: 'Primary' });
  const group = nav.getByRole('button', { name: 'Workforce' });
  if ((await group.getAttribute('aria-expanded')) !== 'true') await d.click(group, { settle: false });
  await d.click(nav.getByRole('link', { name: 'Schedules' }));
  await d.beat(2500);
  const edit = page.getByRole('button', { name: 'Edit schedule for Ava Okafor' });
  await d.scrollTo(edit);
  await d.click(edit, { settle: false });
  const dialog = page.getByRole('dialog', { name: /Schedule · Ava Okafor/ });
  await expect(dialog).toBeVisible();
  await d.mark('zoom to the schedule dialog', dialog);
  for (const l of [/Time zone/, /Effective from/, /Monday start/, /Monday end/]) await d.point(dialog.getByLabel(l).first(), { hold: 1400 });
  await d.point(dialog.getByRole('button', { name: 'Save new version' }), { hold: 2000 });
  await page.keyboard.press('Escape');
  await d.finish();
});

test('10.2', async ({ d, page }) => {
  await d.go('/schedules');
  d.begin();
  await d.click(page.getByRole('navigation', { name: 'Schedules & attendance' }).getByRole('link', { name: 'Attendance' }));
  const roster = page.getByRole('table', { name: 'Attendance roster' });
  await d.mark('zoom to the roster', roster);
  await d.point(roster, { hold: 3000 });
  await d.choose(page.getByLabel('Status', { exact: true }), 'Late');
  await d.beat(2500);
  await d.choose(page.getByLabel('Status', { exact: true }), 'All statuses');
  await d.click(choice(page, 'Week'));
  await d.beat(2500);
  await d.finish();
});

test('10.3', async ({ d, page }) => {
  await d.go('/schedules');
  d.begin();
  await d.click(page.getByRole('complementary', { name: 'Primary' }).getByRole('link', { name: 'Time off' }));
  const tabs = page.getByRole('main');
  await d.click(tabs.getByRole('button', { name: /^Requests/ }));
  const row = page.getByRole('row').filter({ hasText: 'Ava Okafor' }).filter({ has: page.getByRole('button', { name: 'Approve' }) }).first();
  await d.mark('highlight Ava’s request', row);
  await d.point(row, { hold: 2000 });
  await d.click(row.getByRole('button', { name: 'Approve' }), { settle: false });
  await d.beat(2000);
  await d.click(tabs.getByRole('button', { name: 'Calendar', exact: true }));
  await d.beat(3000);
  await d.click(tabs.getByRole('button', { name: 'Policies & holidays', exact: true }));
  await d.mark('zoom to the policies', page.getByRole('button', { name: /New policy/ }));
  for (const b of [/Adjust balance/, /New policy/, /Add holiday/]) {
    const el = page.getByRole('button', { name: b }).first();
    await d.scrollTo(el);
    await d.point(el, { hold: 1800 });
  }
  await d.finish();
});
