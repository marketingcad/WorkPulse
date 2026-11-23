import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { WEB_URL } from './env';

/**
 * The desktop app as INSTALLED from its real installer (the "Desktop installer" workflow), at the path
 * in INSTALLED_APP:
 *   Windows  %LOCALAPPDATA%\Programs\Tallywork\Tallywork.exe (.exe installer) or C:\Program Files\Tallywork\Tallywork.exe (.msi)
 *   macOS    /Applications/Tallywork.app/Contents/MacOS/Tallywork
 *
 * The installed app keeps Electron's security fuses on (no Node inspector), so Playwright's _electron
 * driver cannot attach, and the tests must not turn them off. The app is started with Chromium's own
 * --remote-debugging-port and Playwright connects to its window over CDP, like to a browser.
 *
 * Safety, as with the built app (support/electron.ts): an empty user-data folder per launch, and the
 * app talks only to the isolated test server (TALLYWORK_SERVER).
 */
export interface InstalledApp {
  process: ChildProcess;
  browser: Browser;
  window: Page;
  userData: string;
}

export const installedPath = () => process.env.INSTALLED_APP ?? '';

/** A free TCP port, asked of the operating system. */
async function freePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

export async function launchInstalled(): Promise<InstalledApp> {
  const exe = installedPath();
  if (!exe) throw new Error('INSTALLED_APP is not set');
  const userData = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'workpulse-installed-')));
  const port = await freePort();
  const env: Record<string, string> = { ...(process.env as Record<string, string>), TALLYWORK_SERVER: WEB_URL };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const child = spawn(exe, [`--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], { env, stdio: 'ignore' });

  // Wait for the debugging endpoint (the app's first start on a fresh runner can take a while).
  const deadline = Date.now() + 90_000;
  let browser: Browser | null = null;
  while (!browser) {
    if (child.exitCode !== null) throw new Error(`The installed app exited with code ${child.exitCode} before opening its window`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      /* not listening yet */
    }
    if (!browser) {
      if (Date.now() > deadline) throw new Error('The installed app did not open its debugging endpoint within 90 s');
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const window = context.pages().find((p) => !p.url().startsWith('devtools://')) ?? (await context.waitForEvent('page', { timeout: 60_000 }));
  await window.waitForLoadState('domcontentloaded');
  return { process: child, browser, window, userData };
}

/** Quit the app and remove its user-data folder. */
export async function closeInstalled(a: InstalledApp): Promise<void> {
  await a.browser.close().catch(() => undefined);
  if (a.process.exitCode === null && a.process.pid) {
    const exited = new Promise((r) => (a.process.exitCode !== null ? r(true) : a.process.once('exit', () => r(true))));
    const within = (ms: number) => Promise.race([exited, new Promise((r) => setTimeout(() => r(false), ms))]);
    // Electron starts helper processes: end the whole tree.
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(a.process.pid), '/T', '/F']);
    else a.process.kill('SIGTERM');
    // On macOS the app can stay running after SIGTERM (it lives on in the menu bar): then it is ended.
    if (!(await within(10_000))) {
      a.process.kill('SIGKILL');
      await within(10_000);
    }
  }
  rmSync(a.userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
