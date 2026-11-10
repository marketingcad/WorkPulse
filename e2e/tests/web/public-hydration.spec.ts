import { expect, test } from '../../support/fixtures';

/**
 * The signed-out pages are prerendered when the app is built. Anything they render from the clock
 * must wait for the browser, or the server HTML carries the build machine's date and React throws
 * hydration error #418 and re-renders the page on every visit. Live QA, 7 Nov 2026: the sign-in
 * preview's "Today, <date>" did this on /login, /signup, /download and every page that redirects to
 * sign-in, for any visitor whose date differed from the build's.
 *
 * The browser clock is set to a day no build can have seen, so this fails whatever the time zone
 * and day the suite runs on.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const VISITOR_DAY = new Date('2031-01-15T12:00:00Z');
const PAGES = ['/login', '/signup', '/forgot-password', '/reset-password?token=e2e-unknown', '/invite?token=e2e-unknown', '/portal-invite?token=e2e-unknown', '/download'];

for (const path of PAGES) {
  test(`${path.split('?')[0]} hydrates cleanly when the visitor's date is not the build's`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.setFixedTime(VISITOR_DAY);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The preview's date appears once client effects have run (so hydration is over), and is the visitor's.
    await expect(page.getByText(/^Today, /)).toHaveText('Today, Jan 15, 2031');
    expect(errors).toEqual([]);
  });
}
