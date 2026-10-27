import { defineConfig, devices } from '@playwright/test';
import { LIVE_STATE, LIVE_URL } from './live/env';

const CI = !!process.env.CI;

/**
 * Read-only smoke of a DEPLOYED site (production by default, LIVE_URL to override). See e2e/README.md, "Live smoke".
 *
 * Unlike playwright.config.ts there is no local server and no seeded data: the specs sign in once as a
 * dedicated test account and only read. live/fixtures.ts aborts any write to the site and fails the test.
 */
export default defineConfig({
  testDir: './live',
  outputDir: './test-results/live',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Production rate limits apply: keep the request rate low.
  workers: 2,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [['list'], ['github'], ['html', { open: 'never', outputFolder: 'playwright-report/live' }]] : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/live' }]],
  use: {
    baseURL: LIVE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: 'en-US',
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'live-setup', testMatch: /auth\.setup\.ts/ },
    // Signed out: runs without LIVE_EMAIL / LIVE_PASSWORD.
    { name: 'live-public', testMatch: /public\.spec\.ts/ },
    { name: 'live', testMatch: /(workspace|latency)\.spec\.ts/, dependencies: ['live-setup'], use: { storageState: LIVE_STATE } },
  ],
});
