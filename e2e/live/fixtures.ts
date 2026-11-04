import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { LIVE_DATA, LIVE_ORIGIN, type LiveData } from './env';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Vercel's own analytics beacons: not application data. */
const ALLOWED_WRITES = [/^\/_vercel\//];

interface LiveFixtures {
  /** Write requests to the live site that the guard blocked. Every test asserts this stays empty. */
  blockedWrites: string[];
  /** Uncaught errors in the page. */
  crashes: string[];
  data: LiveData;
}

/**
 * Live smoke tests are read-only: any POST, PUT, PATCH or DELETE to the live site is aborted before it
 * leaves the browser and fails the test, so a page that writes on load is reported instead of touching
 * production data.
 */
export const test = base.extend<LiveFixtures>({
  blockedWrites: [
    async ({ context }, use) => {
      const blocked: string[] = [];
      await context.route('**/*', (route) => {
        const req = route.request();
        const url = new URL(req.url());
        if (url.origin !== LIVE_ORIGIN || READ_METHODS.has(req.method()) || ALLOWED_WRITES.some((p) => p.test(url.pathname))) {
          return route.fallback();
        }
        blocked.push(`${req.method()} ${url.pathname}`);
        return route.abort('blockedbyclient');
      });
      await use(blocked);
      expect(blocked, 'the live suite must not write to production').toEqual([]);
    },
    { auto: true },
  ],
  crashes: async ({ page }, use) => {
    const crashes: string[] = [];
    page.on('pageerror', (e) => crashes.push(e.message));
    await use(crashes);
  },
  data: async ({}, use) => {
    await use(JSON.parse(readFileSync(LIVE_DATA, 'utf8')) as LiveData);
  },
});

export { expect };
