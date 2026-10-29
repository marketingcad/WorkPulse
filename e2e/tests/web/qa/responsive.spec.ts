import { expect, ok, test, uid } from '../../../support/fixtures';
import { ADMIN_STATE } from '../../../support/env';

/**
 * QA: layouts at desktop, tablet and phone widths. Admin pages are covered route by route in
 * page-health.spec.ts; this file covers the signed-out pages and the navigation shell.
 */

const VIEWPORTS = [
  { name: 'desktop', width: 1366, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'phone', width: 390, height: 844 },
];

const PUBLIC = [
  { route: '/login', action: 'Sign in' },
  { route: '/signup', action: 'Create organization' },
  { route: '/forgot-password', action: 'Send reset link' },
];

test.describe('QA · Responsive, signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const vp of VIEWPORTS) {
    for (const { route, action } of PUBLIC) {
      test(`${vp.name} ${route}: fits the screen and the main action can be tapped`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(route);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1);

        const button = page.getByRole('button', { name: action });
        await button.scrollIntoViewIfNeeded();
        const box = (await button.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
        // WCAG 2.5.8: targets at least 24 × 24 CSS pixels.
        expect(box.height).toBeGreaterThanOrEqual(24);
        // Every text field is at least as wide as half the screen on a phone (not squeezed by the side panel).
        for (const input of await page.locator('main input:visible:not([type="checkbox"]):not([type="radio"])').all()) {
          const w = (await input.boundingBox())!.width;
          expect(w).toBeGreaterThanOrEqual(Math.min(vp.width, 480) / 2);
        }
      });
    }

    test(`${vp.name} /download: the download page fits the screen`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/download');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1);
    });
  }
});

test.describe('QA · Responsive navigation shell (admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('desktop and tablet show the side navigation; a phone shows a menu button instead', async ({ page, data }) => {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`/o/${data.orgId}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
      const sidebar = page.getByRole('complementary', { name: 'Primary' });
      const menu = page.getByRole('button', { name: 'Open navigation' });
      if (vp.name === 'phone') {
        await expect(sidebar, vp.name).toBeHidden();
        await expect(menu, vp.name).toBeVisible();
      } else {
        await expect(sidebar, vp.name).toBeVisible();
        await expect(menu, vp.name).toBeHidden();
      }
    }
  });

  test('on a phone, choosing a page in the drawer opens it and closes the drawer', { tag: '@smoke' }, async ({ page, data }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/o/${data.orgId}`);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.locator('div.fixed.inset-0').filter({ has: page.getByRole('button', { name: 'Close navigation' }) });
    await expect(drawer).toBeVisible();
    // Pages sit in collapsible groups.
    await drawer.getByRole('button', { name: /project management/i }).click();
    await drawer.getByRole('link', { name: 'Projects', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${data.orgId}/projects`));
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await expect(drawer).toBeHidden();
  });

  test('at tablet width a wide table scrolls inside its box, not the page (QA-05)', async ({ page, data, adminApi }) => {
    // Long values make the clients table wider than the content area, whatever else the run created.
    for (let i = 0; i < 3; i++)
      await ok(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: `Northwind Traders International ${uid()}`, email: `billing-${uid()}@northwind-traders-international.example.com`, phone: '+1 (555) 010-2030', contact_name: 'Bartholomew Longname-Smythe' } }), 'client');
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`/o/${data.orgId}/clients`);
    const table = page.getByRole('table').first();
    await expect(table).toBeVisible();
    const box = await table.evaluate((t) => ({ inner: t.parentElement!.scrollWidth, outer: t.parentElement!.clientWidth }));
    expect(box.inner, 'the table is wider than its box, so the check means something').toBeGreaterThan(box.outer);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1);
  });

  test('on a phone, tapping outside the drawer closes it', async ({ page, data }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/o/${data.orgId}`);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const backdrop = page.getByRole('button', { name: 'Close navigation' }).first();
    await expect(backdrop).toBeVisible();
    // The backdrop is to the right of the 288px drawer.
    await page.mouse.click(360, 400);
    await expect(page.getByRole('button', { name: 'Close navigation' })).toHaveCount(0);
  });
});
