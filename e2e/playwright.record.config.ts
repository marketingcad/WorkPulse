import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Same suite, but keeps a video, a trace and a final screenshot of EVERY test (not only failures),
 * so you can watch how each flow rendered in the headless browser: `pnpm test:e2e:record`, then
 * `pnpm test:e2e:report`. Larger and slower than a normal run; use it to review, not in CI.
 */
export default defineConfig({
  ...base,
  use: { ...base.use, video: 'on', trace: 'on', screenshot: 'on' },
});
