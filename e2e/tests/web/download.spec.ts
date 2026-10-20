import type { Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { WORKER_STATE } from '../../support/env';

/** The /download page: after a worker clicks an installer, it explains how to install it (first time or update). */
test.use({ storageState: WORKER_STATE });

const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// serve-web.mjs points the installer links at /e2e-installers/*; serve a tiny file instead of a real installer.
async function serveInstallers(page: Page) {
  await page.route('**/e2e-installers/*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'installer', headers: { 'content-disposition': 'attachment' } }),
  );
}

const panel = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('heading', { name: /Your download has started/ }) });

test.describe('on Windows', () => {
  test.use({ userAgent: WINDOWS_UA });

  test('clicking the download shows the Windows install steps', { tag: '@smoke' }, async ({ page }) => {
    await serveInstallers(page);
    await page.goto('/download');
    await expect(panel(page)).toHaveCount(0);

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download for Windows' }).click();
    expect((await download).suggestedFilename()).toBe('Tallywork-Setup.exe');

    const steps = panel(page);
    await expect(steps.getByRole('heading', { name: 'Your download has started. Install WorkPulse on Windows' })).toBeVisible();
    await expect(steps.getByRole('listitem')).toHaveText([/Open Tallywork-Setup\.exe/, /More info, then Run anyway/, /Next, then Install, then Finish/]);
    await expect(steps).toContainText('your tracked time is kept');
  });

  test('the steps follow the installer clicked, not the detected OS', async ({ page }) => {
    await serveInstallers(page);
    await page.goto('/download');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download for macOS' }).click();
    await download;
    await expect(panel(page).getByRole('heading')).toHaveText('Your download has started. Install WorkPulse on macOS');
  });
});

test.describe('on macOS', () => {
  test.use({ userAgent: MAC_UA });

  test('clicking the download shows the macOS install and update steps', { tag: '@smoke' }, async ({ page }) => {
    await serveInstallers(page);
    await page.goto('/download');
    // Before the click, only the short first-launch note.
    await expect(page.getByText('First launch on a Mac')).toBeVisible();
    await expect(panel(page)).toHaveCount(0);

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download for macOS' }).click();
    expect((await download).suggestedFilename()).toBe('Tallywork-mac.dmg');

    const steps = panel(page);
    await expect(steps.getByRole('heading', { name: 'Your download has started. Install WorkPulse on macOS' })).toBeVisible();
    await expect(steps.getByRole('listitem')).toHaveText([/Open Tallywork-mac\.dmg/, /Applications folder.*choose Replace/, /Open Anyway/]);
    await expect(steps).toContainText('Screen Recording');
    // The panel replaces the shorter note instead of repeating it.
    await expect(page.getByText('First launch on a Mac')).toHaveCount(0);
  });
});

test.describe('on Linux', () => {
  test.use({ userAgent: LINUX_UA });

  test('the .deb download keeps its own note and shows no Windows or macOS steps', async ({ page }) => {
    await serveInstallers(page);
    await page.goto('/download');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download for Ubuntu / Debian (.deb)' }).click();
    await download;
    await expect(page.getByText(/Ubuntu and Debian: open the \.deb/)).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
  });
});
