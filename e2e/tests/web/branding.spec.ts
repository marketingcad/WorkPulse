import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE } from '../../support/env';

/**
 * Branding: "WorkPulse – Powered by AI", tagline "Smarter Workforce. Better Business."
 * WorkPulse stays the product name; "Powered by AI" is a small secondary badge; the tagline shows
 * once where it appears (auth pages, dashboard, Help Center, footers), never the old
 * "Track • Focus • Achieve".
 */
const TAGLINE = 'Smarter Workforce. Better Business.';
const SIGNATURE = 'WorkPulse – Powered by AI · Smarter Workforce. Better Business.';
const OLD_TAGLINE = /Track\s*•\s*Focus\s*•\s*Achieve/;

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Primary' });

async function serious(page: Page) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]?.target.join(' ')}`);
}

test.describe('branding: signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('sign-in shows WorkPulse, the AI badge and the tagline', { tag: '@smoke' }, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    const panel = page.getByRole('complementary');
    await expect(panel.getByRole('img', { name: 'WorkPulse' })).toBeVisible();
    await expect(panel.getByTestId('ai-badge')).toHaveText('Powered by AI');
    await expect(panel.getByTestId('brand-tagline')).toHaveText(TAGLINE);
    await expect(page.getByTestId('brand-signature')).toHaveText(SIGNATURE);
    await expect(page.locator('body')).not.toContainText(OLD_TAGLINE);
    await expect(page).toHaveTitle(/WorkPulse/);
  });

  for (const path of ['/signup', '/forgot-password']) {
    test(`${path} carries the brand line on a phone, where the brand panel is hidden`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByTestId('brand-signature')).toBeVisible();
      await expect(page.getByTestId('brand-signature')).toHaveText(SIGNATURE);
      // No sideways scrolling from the brand line.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  test('sign-in has no serious accessibility problem in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await serious(page)).toEqual([]);
  });
});

test.describe('branding: workspace', () => {
  test.use({ storageState: ADMIN_STATE });

  test('sidebar shows WorkPulse with a small Powered by AI badge, and only the sparkle when collapsed', { tag: '@smoke' }, async ({ page, data }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(`/o/${data.orgId}`);
    const brand = sidebar(page).getByTestId('sidebar-brand');
    await expect(brand).toHaveText(/WorkPulse\s*Powered by AI/);
    // The organization keeps the top of the sidebar.
    await expect(sidebar(page).getByRole('button', { name: 'Switch organization' })).toBeVisible();

    await sidebar(page).getByRole('button', { name: 'Collapse navigation' }).click();
    const badge = brand.getByTestId('ai-badge');
    await expect(badge).toHaveAttribute('title', 'Powered by AI');
    await expect(brand.getByText('WorkPulse', { exact: true })).toHaveCount(0);
    await sidebar(page).getByRole('button', { name: 'Expand navigation' }).click();
    await expect(brand).toHaveText(/WorkPulse\s*Powered by AI/);
  });

  test('the phone menu shows the brand too', async ({ page, data }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/o/${data.orgId}`);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('dialog').getByTestId('sidebar-brand')).toHaveText(/WorkPulse\s*Powered by AI/);
  });

  test('the dashboard shows the tagline once, above the title', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('dashboard-tagline')).toHaveText(TAGLINE);
    await expect(page.getByText(TAGLINE, { exact: true })).toHaveCount(1);
    // Other pages do not repeat it.
    await page.goto(`/o/${data.orgId}/timesheets`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(TAGLINE)).toHaveCount(0);
  });

  test('WorkPulse AI shows its name and the Powered by AI badge', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await page.getByTestId('assistant-launcher').click();
    const panel = page.getByTestId('assistant-panel');
    await expect(panel.getByTestId('assistant-brand')).toHaveText(/WorkPulse AI\s*Powered by AI/);
    // The conversation still works as before.
    await expect(panel.getByText('Hi, I’m WorkPulse AI')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Close WorkPulse AI' })).toBeVisible();
  });

  test('the Help Center ends with About WorkPulse', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/help`);
    const about = page.getByTestId('help-about');
    await expect(about).toBeVisible();
    await expect(about.getByRole('heading', { name: 'About WorkPulse' })).toBeAttached();
    await expect(about.getByTestId('ai-badge')).toHaveText('Powered by AI');
    await expect(about.getByTestId('brand-tagline')).toHaveText(TAGLINE);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`dashboard and Help Center have no serious accessibility problem in ${scheme} mode`, async ({ page, data }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of ['', '/help']) {
        await page.goto(`/o/${data.orgId}${path}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await serious(page), path || '/').toEqual([]);
      }
    });
  }

  test('the client portal ends with the brand line', async ({ page, data, adminApi }) => {
    const c = await ok<{ id: string }>(await adminApi.api.post(adminApi.orgApi('/clients'), { data: { name: `Brand Client ${uid()}` } }), 'client');
    await ok(await adminApi.api.put(adminApi.orgApi(`/clients/${c.id}/portal`), { data: { enabled: true, sections: { hours: true, tasks: true, activity: false, screenshots: false } } }), 'portal settings');
    await page.goto(`/o/${data.orgId}/clients/${c.id}/portal`);
    await page.getByRole('button', { name: 'Preview as client' }).click();
    await expect(page.getByTestId('brand-signature')).toHaveText(SIGNATURE);
    await expect(page.locator('body')).not.toContainText(OLD_TAGLINE);
  });
});

test.describe('branding: team manager', () => {
  test.use({ storageState: MANAGER_STATE });

  test('sees the same sidebar brand and dashboard tagline', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}`);
    await expect(sidebar(page).getByTestId('sidebar-brand')).toHaveText(/WorkPulse\s*Powered by AI/);
    await expect(page.getByTestId('dashboard-tagline')).toHaveText(TAGLINE);
  });
});
