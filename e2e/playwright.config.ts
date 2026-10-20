import { defineConfig, devices } from '@playwright/test';
import { DESKTOP_URL, WEB_URL } from './support/env';

const CI = !!process.env.CI;

/**
 * WorkPulse E2E suite. See e2e/README.md.
 *
 * Two isolated servers are started for the run (or reused locally when already up):
 *   web      http://localhost:3100  Next.js app + API, fresh in-memory database (scripts/serve-web.mjs)
 *   desktop  http://localhost:3101  the desktop app's window (scripts/serve-desktop.mjs)
 * The `electron` project launches the real desktop app built by that same script.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalSetup: './support/global-setup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  // One retry on CI to surface (and report) flakiness without hiding real failures locally.
  retries: CI ? 1 : 0,
  // The server runs on single-connection PGlite, so a few workers is the useful maximum.
  workers: CI ? 2 : 3,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['list'], ['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    // E2E_SLOWMO=500 pnpm test:e2e:headed slows every action down so a visible run can be followed.
    launchOptions: { slowMo: Number(process.env.E2E_SLOWMO ?? 0) },
    navigationTimeout: 20_000,
    // Deterministic dates and formatting: the test org and browser both use UTC and en-US.
    timezoneId: 'UTC',
    locale: 'en-US',
  },
  projects: [
    { name: 'web', testDir: './tests/web', use: { ...devices['Desktop Chrome'], baseURL: WEB_URL } },
    { name: 'desktop', testDir: './tests/desktop', use: { ...devices['Desktop Chrome'], baseURL: DESKTOP_URL, viewport: { width: 1120, height: 760 } } },
    // The real Electron app (support/electron.ts). Opens app windows while it runs; needs a display (xvfb on Linux).
    { name: 'electron', testDir: './tests/electron', fullyParallel: false },
    // Opt-in cross-browser smoke of the web app: E2E_CROSS_BROWSER=1 pnpm test:e2e --project=firefox --project=webkit
    ...(process.env.E2E_CROSS_BROWSER
      ? [
          { name: 'firefox', testDir: './tests/web', grep: /@smoke/, use: { ...devices['Desktop Firefox'], baseURL: WEB_URL } },
          { name: 'webkit', testDir: './tests/web', grep: /@smoke/, use: { ...devices['Desktop Safari'], baseURL: WEB_URL } },
        ]
      : []),
  ],
  webServer: [
    {
      command: 'node scripts/serve-web.mjs',
      url: `${WEB_URL}/api/v1/health`,
      reuseExistingServer: !CI,
      // Includes the production build on a cold start.
      timeout: 600_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    { command: 'node scripts/serve-desktop.mjs', url: DESKTOP_URL, reuseExistingServer: !CI, timeout: 180_000 },
  ],
});
