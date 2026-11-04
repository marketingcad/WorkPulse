import { expect, test } from '../kit';

test('03.1', async ({ d, page }) => {
  await d.go('');
  await expect(page.getByText('Waiting for approval')).toBeVisible();
  d.begin();
  await d.mark('zoom to This month', page.getByText('This month', { exact: true }).first());
  for (const label of ['Time logged', 'Est. pay', 'Billable time', 'Est. billable']) await d.point(page.getByText(label, { exact: true }).first(), { hold: 1600 });
  await d.point(page.getByText('Worked today', { exact: true }).first(), { hold: 2500 });
  const approval = page.getByText('Waiting for approval', { exact: true });
  await d.mark('highlight Waiting for approval', approval);
  await d.point(approval, { hold: 2500 });
  await d.point(page.getByText('Project budgets', { exact: true }), { hold: 2000 });
  await d.scroll(500);
  await d.beat(2000);
  await d.scroll(-500);
  const scope = page.getByRole('button', { name: 'Me', exact: true }).or(page.getByRole('radio', { name: 'Me', exact: true })).first();
  await d.mark('highlight the scope switch', scope);
  await d.click(scope);
  await d.beat(2000);
  await d.click(page.getByRole('button', { name: 'All', exact: true }).or(page.getByRole('radio', { name: 'All', exact: true })).first());
  await d.finish();
});

test('03.2', async ({ d, page }) => {
  await d.go('');
  d.begin();
  await d.click(page.getByRole('button', { name: 'Customize' }), { settle: false });
  const moveUp = page.getByRole('button', { name: 'Move up' }).nth(1);
  await d.mark('zoom to a card’s controls', moveUp);
  await d.point(page.getByRole('button', { name: 'Hide widget' }).nth(1), { hold: 1500 });
  await d.click(moveUp, { settle: false });
  await d.beat(1500);
  const hidden = page.getByText('Hidden widgets');
  await d.scrollTo(hidden);
  await d.point(hidden, { hold: 3000 });
  const save = page.getByRole('button', { name: 'Save layout' });
  await d.scrollTo(save);
  await d.mark('highlight Save layout', save);
  await d.click(save, { settle: false });
  await expect(page.getByText('Dashboard saved')).toBeVisible();
  await d.finish();
});

test('03.3', async ({ d, page }) => {
  await d.go('');
  d.begin();
  const nav = page.getByRole('complementary', { name: 'Primary' });
  const group = nav.getByRole('button', { name: 'Time Tracking' });
  if ((await group.getAttribute('aria-expanded')) !== 'true') await d.click(group, { settle: false });
  await d.beat(2500);
  await d.click(page.getByRole('button', { name: 'Switch organization' }), { settle: false });
  const orgMenu = page.getByRole('menuitem', { name: 'New organization' });
  await d.mark('zoom to the organization switcher', orgMenu);
  await d.point(orgMenu, { hold: 2500 });
  await page.keyboard.press('Escape');
  await d.click(page.getByRole('button', { name: /^Notifications/ }), { settle: false });
  const markAll = page.getByRole('button', { name: 'Mark all read' });
  await d.mark('zoom to notifications', markAll);
  await d.point(markAll, { hold: 3000 });
  await page.keyboard.press('Escape');
  await d.click(page.getByRole('button', { name: 'Account menu' }), { settle: false });
  const menu = page.getByRole('menu');
  await d.mark('zoom to the account menu', menu);
  await d.point(menu.getByRole('menuitem', { name: 'Profile & devices' }), { hold: 1500 });
  await d.point(menu.getByRole('menuitem', { name: 'What is monitored' }), { hold: 1500 });
  await d.point(page.getByRole('radio', { name: 'dark theme' }), { hold: 2000 });
  await page.keyboard.press('Escape');
  await d.finish();
});

test('03.4', async ({ d, page }) => {
  await d.go('');
  d.begin();
  await d.click(page.getByRole('complementary', { name: 'Primary' }).getByRole('link', { name: 'Help' }));
  const search = page.getByRole('searchbox', { name: 'Search help' });
  await d.type(search, 'invoice');
  const results = page.getByRole('region', { name: 'Search results' });
  await d.mark('zoom to the search results', results);
  await d.click(results.getByRole('button', { name: /Create and send an invoice/ }), { settle: false });
  await d.beat(3500);
  await d.click(page.getByRole('button', { name: 'Clear search' }), { settle: false });
  await d.click(page.getByRole('button', { name: 'Start the tour' }));
  const tour = page.getByTestId('product-tour');
  await expect(tour).toBeVisible();
  await d.mark('zoom to the tour card', tour.getByRole('dialog'));
  for (let i = 0; i < 3; i++) {
    await d.beat(2200);
    await d.click(tour.getByRole('button', { name: 'Next' }), { settle: false });
  }
  await d.beat(2000);
  await d.click(tour.getByRole('button', { name: 'Skip tour' }), { settle: false });
  await d.finish();
});
