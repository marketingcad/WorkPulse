import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/** The main workspace pages open for an admin, without crashing in the browser. */
test.use({ storageState: ADMIN_STATE });

const PAGES: Array<[path: string, heading: string]> = [
  ['', 'Overview'],
  ['/timesheets', 'My timesheet'],
  ['/pay-stubs', 'Pay stubs'],
  ['/workers', 'Members'],
  ['/teams', 'Teams'],
  ['/clients', 'Clients'],
  ['/projects', 'Projects'],
  ['/timesheets/all', 'All time entries'],
  ['/finance/payroll', 'Payroll'],
  ['/reports', 'Reports'],
  ['/settings/audit', 'Audit log'],
];

for (const [path, heading] of PAGES) {
  test(`${heading} page opens`, { tag: '@smoke' }, async ({ page, data }) => {
    const crashes: string[] = [];
    page.on('pageerror', (e) => crashes.push(e.message));
    await page.goto(`/o/${data.orgId}${path}`);
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    expect(crashes).toEqual([]);
  });
}

test('the sidebar navigates between sections', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}`);
  const nav = page.getByRole('complementary', { name: 'Primary' });
  // Groups other than the current page's are collapsed: open "Workspace" first.
  const group = nav.getByRole('button', { name: 'Workspace' });
  if ((await group.getAttribute('aria-expanded')) === 'false') await group.click();
  await nav.getByRole('link', { name: 'Teams' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/teams`));
  await expect(page.getByRole('heading', { level: 1, name: 'Teams' })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(data.teamName) })).toBeVisible();
});

test('an admin who is in no payroll sees the pay stubs empty state', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}/pay-stubs`);
  await expect(page.getByText('No pay stubs yet')).toBeVisible();
});
