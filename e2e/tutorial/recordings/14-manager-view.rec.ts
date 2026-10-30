import { expect, test } from '../kit';

test('14.1', async ({ d, page }) => {
  await d.go('');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  d.begin();
  const role = page.getByText('Team Manager', { exact: true }).first();
  await d.mark('highlight the role name', role);
  await d.point(role, { hold: 2500 });
  await d.point(page.getByRole('button', { name: 'Team', exact: true }).or(page.getByRole('radio', { name: 'Team', exact: true })).first(), { hold: 2500 });
  const nav = page.getByRole('complementary', { name: 'Primary' });
  await d.mark('zoom to the sidebar', nav);
  for (const group of ['Time Tracking', 'Workforce', 'Project Management', 'Finance', 'Reports']) {
    const button = nav.getByRole('button', { name: group });
    if (!(await button.isVisible())) continue;
    if ((await button.getAttribute('aria-expanded')) !== 'true') await d.click(button, { settle: false });
    await d.beat(1300);
  }
  await d.click(nav.getByRole('link', { name: 'Approvals' }));
  await d.beat(3500);
  await d.finish();
});
