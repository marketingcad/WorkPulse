import { choice, expect, label, test } from '../kit';

test('12.1', async ({ d, page }) => {
  await d.go('');
  d.begin();
  const nav = page.getByRole('complementary', { name: 'Primary' });
  const group = nav.getByRole('button', { name: 'Reports' });
  if ((await group.getAttribute('aria-expanded')) !== 'true') await d.click(group, { settle: false });
  await d.click(nav.getByRole('link', { name: 'Summary' }));
  await expect(page.getByRole('heading', { level: 1, name: 'Summary' })).toBeVisible();
  await d.mark('zoom to the totals', page.getByText('Time logged', { exact: true }).first());
  for (const k of ['Time logged', 'Est. pay', 'Billable time', 'Est. billable', 'Activity', 'Days off']) await d.point(page.getByText(k, { exact: true }).first(), { hold: 900 });
  await d.click(choice(page.getByRole('main'), 'Weekly'));
  await d.click(page.getByRole('button', { name: 'Previous period' }));
  await d.beat(1500);
  for (const k of ['Hours by client', 'Hours by project']) {
    await d.scrollTo(page.getByText(k, { exact: true }).first());
    await d.beat(1800);
  }
  const people = page.getByRole('table', { name: 'Time and money per person' });
  await d.scrollTo(people);
  await d.mark('zoom to the People table', people);
  await d.beat(2500);
  await d.scroll(-4000);
  await d.point(page.getByRole('button', { name: 'Export CSV' }), { hold: 1500 });
  await d.finish();
});

test('12.2', async ({ d, page }) => {
  await d.go('/insights');
  d.begin();
  await d.click(page.getByRole('complementary', { name: 'Primary' }).getByRole('link', { name: 'Report library' }));
  for (const r of ['Time & activity', 'Attendance', 'Timesheet approval', 'Billing']) await d.point(page.getByRole('link', { name: new RegExp(`^${r}`) }).first(), { hold: 1100 });
  await d.click(page.getByRole('link', { name: /^Time & activity/ }).first());
  await expect(page.getByRole('heading', { level: 1, name: 'Time & activity' })).toBeVisible();
  const range = page.getByLabel('Date range');
  await d.mark('zoom to the filters and grouping', range);
  await d.select(range, 'last_month');
  const groupBy = page.getByRole('group', { name: 'Group by' });
  await d.click(groupBy.getByRole('button', { name: 'Client', exact: true }), { settle: false });
  await d.settle();
  await d.beat(2500);
  await d.click(page.getByRole('button', { name: 'Export' }), { settle: false });
  await d.mark('zoom to the Export menu', page.getByRole('menuitem', { name: 'CSV', exact: true }));
  await d.beat(1500);
  const download = page.waitForEvent('download');
  await d.click(page.getByRole('menuitem', { name: 'CSV', exact: true }), { settle: false });
  await download;
  await d.beat(1500);
  await d.finish();
});

test('12.3', async ({ d, page }) => {
  await d.go('/reports/time-activity');
  d.begin();
  await d.click(page.getByRole('button', { name: 'Save report' }), { settle: false });
  const dialog = page.getByRole('dialog', { name: 'Save report' });
  await d.mark('zoom to the Save report dialog', dialog);
  await d.type(dialog.getByLabel(label('Name')), 'Monthly hours by project');
  const range = dialog.getByLabel(label('Date range'));
  if (await range.isVisible()) await d.choose(range, 'Last month');
  const schedule = dialog.getByRole('switch', { name: 'Email on a schedule' }).or(dialog.getByLabel('Email on a schedule')).first();
  await d.click(schedule, { settle: false });
  await d.choose(dialog.getByLabel(label('Frequency')), 'Monthly');
  await d.choose(dialog.getByLabel(label('Format')), 'PDF');
  await d.beat(1500);
  await d.click(dialog.getByRole('button', { name: 'Save', exact: true }), { settle: false });
  await expect(page.getByText('Report saved')).toBeVisible();
  await d.go('/reports');
  await d.point(page.getByText('Monthly hours by project').first(), { hold: 2500 });
  await d.finish();
});
