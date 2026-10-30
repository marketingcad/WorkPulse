import { expect, test } from '../kit';

test('01.1', async ({ d, page }) => {
  await d.go('');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  d.begin();
  await d.mark('push in on This month', page.getByText('This month', { exact: true }).first());
  await d.point(page.getByText('Time logged').first(), { hold: 1500 });
  await d.point(page.getByText('Billable time').first(), { hold: 1500 });
  await d.point(page.getByText('Est. billable').first(), { hold: 1500 });
  await d.finish();
});

test('01.2', async ({ d, page }) => {
  await d.go('/workers');
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  d.begin();
  const manager = page.getByText('Team Manager', { exact: true }).filter({ visible: true }).first();
  await d.point(manager, { hold: 1500 });
  await d.mark('highlight a Team Manager role', manager);
  const worker = page.getByText('Worker', { exact: true }).filter({ visible: true }).first();
  await d.point(worker, { hold: 1500 });
  await d.mark('highlight a Worker role', worker);
  await d.beat(4000);
  const badge = page.getByText('Demo data', { exact: true });
  await d.point(badge, { hold: 1500 });
  await d.mark('demo data badge', badge);
  await d.finish();
});

test('01.3', async ({ d, page }) => {
  await d.go('');
  d.begin();
  const nav = page.getByRole('complementary', { name: 'Primary' });
  await d.mark('zoom to the sidebar', nav);
  for (const group of ['Time Tracking', 'Workforce', 'Project Management', 'Finance', 'Reports']) {
    const button = nav.getByRole('button', { name: group });
    if ((await button.getAttribute('aria-expanded')) !== 'true') await d.click(button, { settle: false });
    else await d.point(button);
    await d.beat(1800);
  }
  await d.point(nav.getByRole('link', { name: 'Settings' }), { hold: 1200 });
  await d.point(nav.getByRole('link', { name: 'Help' }), { hold: 1200 });
  await d.finish();
});
