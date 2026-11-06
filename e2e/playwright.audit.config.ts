import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Live UI audit (audit/live-audit.spec.ts): opens every workspace page as each role, at four screen
 * sizes and in dark mode, and records console errors, crashes, failed requests, broken images,
 * sideways scrolling and accessibility problems, with screenshots, in e2e/.tmp/live-audit.
 * `pnpm test:e2e:audit`.
 *
 * Not part of `pnpm test:e2e`. It creates users of its own (a team manager, a client viewer), and the
 * full regression run already uses the whole per-IP sign-up and invitation budget that production
 * rate limits allow, so it runs on its own, against its own fresh server (same isolated setup).
 */
export default defineConfig({
  ...base,
  testDir: './audit',
  outputDir: './.tmp/audit-results',
  timeout: 10 * 60_000,
  projects: [{ name: 'audit', use: { ...base.projects![0]!.use } }],
  // The web server only: the audit opens no desktop window.
  webServer: Array.isArray(base.webServer) ? base.webServer.slice(0, 1) : base.webServer,
});
