import { defineConfig, devices } from '@playwright/test';
import { TUTORIAL_DESKTOP_URL, TUTORIAL_URL } from './tutorial/env';

/**
 * Records the WorkPulse video tutorial: one clip per scene of tutorial/scenes.ts, at 1920×1080,
 * against an isolated server seeded with demo data (tutorial/serve-tutorial.mjs, port 3200).
 * `pnpm tutorial:record`, then find the clips in e2e/tutorial/clips. See tutorial/README.md.
 *
 * Not part of `pnpm test:e2e`: its own test folder, its own server and its own data.
 */
/** Video records CSS pixels, so the page is laid out at the video's own size. */
const VIEWPORT = { width: 1920, height: 1080 };

export default defineConfig({
  testDir: './tutorial/recordings',
  testMatch: '**/*.rec.ts',
  outputDir: './.tmp/tutorial-results',
  globalSetup: './tutorial/setup.ts',
  // Scenes run in order, one at a time, so the clips follow the script and the demo data changes
  // the way the story says (an invoice is created before it is sent, and so on).
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 5 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    viewport: VIEWPORT,
    video: { mode: 'on', size: { width: 1920, height: 1080 } },
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // The demo organization's time zone, so times on screen read like a normal working day.
    timezoneId: 'America/New_York',
    locale: 'en-US',
    colorScheme: 'light',
  },
  // One project, so the recordings run in file order (01-…, 02-…), which is the story's order: the
  // worker's day on the desktop app (07-desktop-…) happens before managers review it. Desktop
  // recordings switch to the desktop window themselves (kit.ts: useDesktopWindow).
  projects: [{ name: 'tutorial', use: { ...devices['Desktop Chrome'], viewport: VIEWPORT, baseURL: TUTORIAL_URL } }],
  webServer: [
    {
      command: 'node tutorial/serve-tutorial.mjs',
      url: `${TUTORIAL_URL}/api/v1/health`,
      reuseExistingServer: true,
      // Includes seeding two weeks of demo data.
      timeout: 30 * 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'node scripts/serve-desktop.mjs',
      url: TUTORIAL_DESKTOP_URL,
      reuseExistingServer: true,
      timeout: 180_000,
      env: { E2E_DESKTOP_PORT: new URL(TUTORIAL_DESKTOP_URL).port, E2E_SKIP_BUILD: '1' },
    },
  ],
});
