import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE } from '../../support/env';

/**
 * The Performance pages show scores stored once a day (or when an admin recalculates), so each says
 * how old they are (QA round 7, BUG-31: after an approval they showed the old hours, with no time).
 * Against the real server: the time comes from the scores the page shows.
 */
const PAGES = (base: string, memberId: string) => [
  { name: 'Overview', url: `${base}/performance`, admin: false },
  { name: 'Leaderboards', url: `${base}/performance/leaderboards`, admin: true },
  { name: 'Teams', url: `${base}/performance/teams`, admin: true },
  { name: 'Workers', url: `${base}/performance/workers`, admin: true },
  { name: 'Worker profile', url: `${base}/performance/workers/${memberId}`, admin: true },
];

test.describe('Performance scores say when they are from', () => {
  test.use({ storageState: ADMIN_STATE });

  test('every score page shows the time of its scores; admins are told how to update them', async ({ page, data }) => {
    for (const p of PAGES(`/o/${data.orgId}`, data.worker.membershipId)) {
      await page.goto(p.url);
      const asOf = page.getByTestId('scores-as-of');
      await expect(asOf, p.name).toContainText(/Scores as of .+\. They update once a day/);
      // The Overview has the Recalculate button itself; the other pages point to it.
      if (p.admin) await expect(asOf, p.name).toContainText('To update them now, recalculate on the Overview.');
      else await expect(asOf, p.name).not.toContainText('recalculate on the Overview');
    }
  });
});

test.describe('Performance scores for a team manager', () => {
  test.use({ storageState: MANAGER_STATE });

  test('a manager sees how old the scores are, without the admin-only hint', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/performance/teams`);
    const asOf = page.getByTestId('scores-as-of');
    await expect(asOf).toContainText(/Scores as of .+\. They update once a day/);
    await expect(asOf).not.toContainText('recalculate');
  });
});
