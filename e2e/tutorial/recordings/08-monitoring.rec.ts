import { startWorking } from '../desktop';
import { choice, expect, test } from '../kit';

/** The most recent weekday before today, in the organization's time zone (screenshots are seeded for it). */
function lastWorkday(): string {
  const day = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  do day.setDate(day.getDate() - 1);
  while ([0, 6].includes(day.getDay()));
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

test('08.1', async ({ d, page }) => {
  await startWorking(['liam.walsh@demo.tallywork.app', 'sofia.moreno@demo.tallywork.app', 'isla.reyes@demo.tallywork.app', 'lucas.lindqvist@demo.tallywork.app', 'zara.haddad@demo.tallywork.app']);
  await d.go('');
  d.begin();
  const nav = page.getByRole('complementary', { name: 'Primary' });
  const group = nav.getByRole('button', { name: 'Time Tracking' });
  if ((await group.getAttribute('aria-expanded')) !== 'true') await d.click(group, { settle: false });
  await d.click(nav.getByRole('link', { name: 'Live' }));
  await expect(page.getByRole('heading', { level: 1, name: 'Who is working now' })).toBeVisible();
  const working = page.getByText('Working', { exact: true }).first();
  await d.mark('zoom to the status counts', working);
  for (const k of ['Working', 'Idle / paused', 'Offline', 'Members tracked']) await d.point(page.getByText(k, { exact: true }).first(), { hold: 1100 });
  await d.click(page.getByRole('button', { name: /^Working \d+/ }).or(page.getByRole('radio', { name: /^Working \d+/ })).first(), { settle: false });
  await d.beat(2000);
  await d.click(page.getByRole('button', { name: 'Actions for Lucas Lindqvist' }), { settle: false });
  const menu = page.getByRole('menu');
  await d.mark('zoom to the actions menu', menu);
  await d.point(menu.getByRole('menuitem', { name: 'View activity' }), { hold: 1000 });
  await d.point(menu.getByRole('menuitem', { name: 'View session' }), { hold: 1000 });
  await d.click(menu.getByRole('menuitem', { name: 'Force stop timer' }), { settle: false });
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'Force stop this timer?' });
  await d.beat(2500);
  await d.click(confirm.getByRole('button', { name: 'Stop timer' }));
  await expect(page.getByText('Stopped Lucas Lindqvist')).toBeVisible();
  await d.finish();
});

test('08.2', async ({ d, page }) => {
  await d.go('/tracking/live');
  d.begin();
  await d.click(page.getByRole('group', { name: 'Sections' }).getByRole('button', { name: 'Session history', exact: true }).or(page.getByRole('link', { name: 'Session history' })).first());
  await d.point(page.getByLabel('Date range'), { hold: 1500 });
  await d.point(page.getByLabel('Member', { exact: true }), { hold: 1500 });
  await d.click(page.getByRole('row').nth(1));
  const drawer = page.getByRole('dialog').first();
  await d.mark('zoom to the session details', drawer);
  for (const t of ['Worked', 'Segments', 'State changes']) {
    const el = drawer.getByText(t, { exact: true }).first();
    await d.scrollTo(el);
    await d.beat(1800);
  }
  await d.point(drawer.getByRole('link', { name: /View activity for this day/ }), { hold: 1500 });
  await d.finish();
});

test('08.3', async ({ d, page, device }) => {
  const ava = (await device()).boot.worker.membership_id;
  await d.go(`/activity?member=${ava}&date=${lastWorkday()}`);
  await expect(page.getByRole('heading', { level: 2, name: /Ava Okafor/ })).toBeVisible();
  d.begin();
  await d.point(page.getByText('Timeline').first(), { hold: 2500 });
  await d.click(page.getByLabel('Only blocks with screenshots'), { settle: false });
  await d.beat(1500);
  const block = page.getByRole('button', { name: /, activity \d+%/ }).first();
  await d.mark('zoom to a screenshot block', block);
  await d.click(block, { settle: false });
  await d.beat(3000);
  await d.point(page.getByRole('complementary', { name: 'Block details' }), { hold: 2000 });
  const tabs = page.getByRole('main');
  await d.click(choice(tabs, 'Apps'));
  await d.mark('zoom to the Apps list', page.getByRole('main'));
  await d.beat(3500);
  await d.click(choice(tabs, 'URLs'));
  await d.beat(3000);
  await d.finish();
});

test('08.4', async ({ d, page }) => {
  await d.go('/tracking/live');
  d.begin();
  await d.click(page.getByRole('complementary', { name: 'Primary' }).getByRole('link', { name: 'End-of-day reports' }));
  for (const k of ['Reports', 'People reporting', 'Marked finished', 'Time covered']) await d.point(page.getByText(k, { exact: true }).first(), { hold: 1100 });
  const read = page.getByRole('button', { name: 'Read full report from Ava Okafor' }).first();
  await d.scrollTo(read);
  await d.click(read, { settle: false });
  const dialog = page.getByRole('dialog', { name: 'Ava Okafor' });
  await expect(dialog).toBeVisible();
  await d.mark('zoom to the report dialog', dialog);
  await d.beat(4500);
  await d.click(dialog.getByRole('button', { name: 'Next report' }), { settle: false });
  await d.beat(3000);
  await d.click(page.getByRole('dialog').getByRole('button', { name: 'Copy report' }), { settle: false });
  await d.beat(1500);
  await d.click(page.getByRole('dialog').getByRole('button', { name: 'Close' }).last(), { settle: false });
  await d.finish();
});

test('08.5', async ({ d, page }) => {
  await d.go('');
  d.begin();
  await d.click(page.getByRole('button', { name: 'Account menu' }), { settle: false });
  await d.click(page.getByRole('menuitem', { name: 'What is monitored' }));
  await expect(page.getByRole('heading', { level: 1, name: 'What is monitored' })).toBeVisible();
  for (const panel of ['While you track time', 'Limits and time rules', 'Who can see this data']) {
    const h = page.getByText(panel, { exact: true }).first();
    await d.scrollTo(h);
    if (panel === 'Who can see this data') await d.mark('zoom to Who can see this data', h);
    await d.beat(3500);
  }
  await d.finish();
});
