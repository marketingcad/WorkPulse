import type { Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { WORKER_STATE } from '../../support/env';

/**
 * The /download page: after a worker clicks an installer, a dialog explains how to install it (first
 * time or update) and links to the step-by-step guide with screenshots.
 */
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

const panel = (page: Page) => page.getByRole('dialog', { name: /Your download has started/ });

test.describe('on Windows', () => {
  test.use({ userAgent: WINDOWS_UA });

  test('clicking the download shows the Windows install steps', { tag: '@smoke' }, async ({ page }) => {
    await serveInstallers(page);
    await page.goto('/download');
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByText('Download and run the installer.')).toBeVisible();
    // The page offers no website sign-out.
    await expect(page.getByRole('button', { name: /sign out/i })).toHaveCount(0);

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download for Windows' }).click();
    expect((await download).suggestedFilename()).toBe('Tallywork-Setup.exe');
    // The installer's own steps replace the general ones instead of repeating them.
    await expect(page.getByText('Download and run the installer.')).toHaveCount(0);

    const steps = panel(page);
    await expect(steps.getByRole('heading', { name: 'Your download has started. Install WorkPulse on Windows' })).toBeVisible();
    await expect(steps.getByRole('listitem')).toHaveText([/Open Tallywork-Setup\.exe/, /More info, then Run anyway/, /Next, then Install, then Finish/]);
    await expect(steps).toContainText('your tracked time is kept');

    // The dialog leads to the full guide with a picture for every step.
    await steps.getByRole('link', { name: 'Open the step-by-step Windows guide (with pictures)' }).click();
    await expect(page).toHaveURL(/\/download\/guide\/windows$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Set up WorkPulse on Windows' })).toBeVisible();
    const guide = page.getByRole('list', { name: 'Steps to set up WorkPulse on Windows' });
    await expect(guide.getByRole('heading', { level: 2 })).toHaveText([/Open the downloaded file/, /More info/, /Run anyway/, /Install/, /Finish/, /Sign in/, /Start tracking/]);
    // Each step has its screenshot (or, until it is added, a frame saying what it will show).
    await expect(guide.getByRole('img')).toHaveCount(7);
    await expect(guide.getByRole('img').nth(2)).toHaveAccessibleName(/Tallywork-Setup.exe and the Run anyway button/);
    await page.getByRole('link', { name: 'Back to download' }).click();
    await expect(page).toHaveURL(/\/download$/);
  });

  test('after the dialog is closed, the guide stays one click away', async ({ page }) => {
    await serveInstallers(page);
    await page.goto('/download');
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download for Windows' }).click();
    await download;
    await panel(page).getByRole('button', { name: 'Close' }).last().click();
    await expect(panel(page)).toHaveCount(0);
    await page.getByRole('link', { name: 'Open the step-by-step Windows guide (with pictures)' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Set up WorkPulse on Windows' })).toBeVisible();
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

    await steps.getByRole('link', { name: 'Open the step-by-step macOS guide (with pictures)' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Set up WorkPulse on macOS' })).toBeVisible();
    const guide = page.getByRole('list', { name: 'Steps to set up WorkPulse on macOS' });
    await expect(guide.getByRole('listitem')).toHaveCount(8);
    await expect(guide.getByRole('heading', { name: /Allow it in Privacy & Security/ })).toBeVisible();
    await expect(guide).toContainText('Open Anyway');
    await expect(guide.getByRole('heading', { name: /Allow Screen Recording/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Updating later' })).toBeVisible();
    // The other system's guide is linked too.
    await page.getByRole('link', { name: 'Windows guide' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Set up WorkPulse on Windows' })).toBeVisible();
  });
});

test.describe('on Linux', () => {
  test.use({ userAgent: LINUX_UA });

  test('the .deb download shows the Ubuntu steps and leads to the Ubuntu guide', async ({ page }) => {
    await serveInstallers(page);
    await page.goto('/download');
    // Before the click: the Linux note, with the AppImage for other distributions.
    await expect(page.getByText(/Ubuntu and Debian: open the \.deb/)).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download for Ubuntu / Debian (.deb)' }).click();
    await download;

    const steps = panel(page);
    await expect(steps.getByRole('heading', { name: 'Your download has started. Install WorkPulse on Ubuntu / Debian' })).toBeVisible();
    await expect(steps.getByRole('listitem')).toHaveText([/Open in Terminal/, /sudo apt install \.\/Tallywork-linux\.deb/, /Ubuntu on Xorg/]);
    await expect(steps).not.toContainText('Windows');

    await steps.getByRole('link', { name: 'Open the step-by-step Ubuntu / Debian guide (with pictures)' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Set up WorkPulse on Ubuntu / Debian' })).toBeVisible();
    const guide = page.getByRole('list', { name: 'Steps to set up WorkPulse on Ubuntu / Debian' });
    await expect(guide.getByRole('listitem')).toHaveCount(6);
    // The install command is shown as text people can copy.
    await expect(guide.locator('code').first()).toHaveText('sudo apt install ./Tallywork-linux.deb');
    await expect(guide.getByRole('heading', { name: /Ubuntu on Xorg/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Other Linux distributions (AppImage)' })).toBeVisible();
    await expect(page.locator('code').last()).toContainText('chmod +x Tallywork-linux.AppImage');
  });
});

test.describe('setup guides', () => {
  test('open without signing in, and an unknown system is not found', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto('/download/guide/macos');
    await expect(page.getByRole('heading', { level: 1, name: 'Set up WorkPulse on macOS' })).toBeVisible();
    expect((await page.goto('/download/guide/amiga'))!.status()).toBe(404);
    await ctx.close();
  });

  test('fit a phone screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const p of ['macos', 'windows', 'linux']) {
      await page.goto(`/download/guide/${p}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
  });
});
