import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import { expect, test as base } from './fixtures';
import { PASSWORD, WEB_URL } from './env';

/**
 * The REAL desktop app (Electron main process + preload + window), built by scripts/serve-desktop.mjs.
 *
 * Safety: every launch gets its own empty user-data folder (sign-in, offline queue, settings), so a
 * test never reads or changes a WorkPulse app installed on this computer, and the single-instance lock
 * never meets a running copy. The app talks only to the isolated test server (TALLYWORK_SERVER).
 */
const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/desktop');
const ELECTRON = createRequire(path.join(DESKTOP_DIR, 'package.json'))('electron') as unknown as string;

export interface DesktopApp {
  app: ElectronApplication;
  window: Page;
  userData: string;
}

async function launch(): Promise<DesktopApp> {
  const userData = mkdtempSync(path.join(os.tmpdir(), 'workpulse-e2e-'));
  const env: Record<string, string> = { ...(process.env as Record<string, string>), TALLYWORK_SERVER: WEB_URL };
  // VS Code terminals set this, which makes Electron run as plain Node; dev-server URLs must not leak in either.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const app = await _electron.launch({ executablePath: ELECTRON, args: [DESKTOP_DIR, `--user-data-dir=${userData}`], env, timeout: 60_000 });
  // Fail fast if isolation did not take effect, before anything is stored.
  expect(await app.evaluate(({ app: a }) => a.getPath('userData'))).toBe(userData);
  const window = await app.firstWindow();
  return { app, window, userData };
}

export const test = base.extend<{ desktopApp: DesktopApp }>({
  desktopApp: async ({}, use, testInfo) => {
    test.skip(process.platform === 'linux' && !process.env.DISPLAY, 'Electron needs a display: run under xvfb-run on Linux');
    const d = await launch();
    await use(d);
    if (testInfo.status !== testInfo.expectedStatus) await testInfo.attach('app-window', { body: await d.window.screenshot().catch(() => Buffer.alloc(0)), contentType: 'image/png' });
    await d.app.close().catch(() => undefined);
    rmSync(d.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  },
});

/** Sign in through the app's own form (email + password); the app opens straight on Home. */
export async function signIn(window: Page, email: string): Promise<void> {
  await expect(window.getByRole('heading', { level: 1, name: 'Sign in to start tracking' })).toBeVisible();
  await window.getByLabel('Email').fill(email);
  await window.getByLabel('Password').fill(PASSWORD);
  await window.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(window.getByRole('navigation', { name: 'Primary' })).toBeVisible();
}

export { expect };
