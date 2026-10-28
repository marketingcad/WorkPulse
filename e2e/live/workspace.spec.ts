import { LIVE_STATE } from './env';
import { expect, test } from './fixtures';

/** The main workspace pages open for the live test account (an admin of its own test organization). */
test.use({ storageState: LIVE_STATE });

const PAGES: Array<[path: string, heading: string]> = [
  ['', 'Overview'],
  ['/timesheets', 'My timesheet'],
  ['/pay-stubs', 'Pay stubs'],
  ['/workers', 'Members'],
  ['/teams', 'Teams'],
  ['/clients', 'Clients'],
  ['/projects', 'Projects'],
  ['/timesheets/all', 'Time entries'],
  ['/finance/payroll', 'Payroll'],
  ['/reports', 'Report library'],
  ['/settings/audit', 'Audit log'],
  ['/help', 'Help Center'],
];

for (const [path, heading] of PAGES) {
  test(`${heading} page opens`, { tag: '@smoke' }, async ({ page, data, crashes }) => {
    await page.goto(`/o/${data.orgId}${path}`);
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    expect(crashes).toEqual([]);
  });
}

test('the sidebar navigates between sections', async ({ page, data }) => {
  await page.goto(`/o/${data.orgId}`);
  const nav = page.getByRole('complementary', { name: 'Primary' });
  const group = nav.getByRole('button', { name: 'Workforce' });
  if ((await group.getAttribute('aria-expanded')) === 'false') await group.click();
  await nav.getByRole('link', { name: 'Members' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
});

test('the signed-in API returns the test account', async ({ page, data }) => {
  // page.request shares the browser's session cookie.
  const res = await page.request.get('/api/v1/me');
  expect(res.status()).toBe(200);
  const me = (await res.json()) as { organizations: Array<{ id: string }> };
  expect(me.organizations.map((o) => o.id)).toContain(data.orgId);
});
