import { readFileSync, existsSync } from 'node:fs';
import type { ElectronApplication } from '@playwright/test';
import { expect, openPage, signIn, test } from '../../support/electron';
import { usd } from '../../support/fixtures';

/**
 * The real desktop app: Electron main process, preload bridge and window, against the test server.
 * Covers what the browser-served window cannot: sign-in and secure storage, IPC validation, and the
 * main process fetching a pay stub PDF and writing it where the person chose.
 */

/** Replace the native Save dialog (and "open the file") in the main process; returns what was asked. */
async function stubSaveDialog(app: ElectronApplication, answer: { canceled: boolean; filePath?: string }) {
  await app.evaluate(({ dialog, shell }, a) => {
    const g = globalThis as unknown as { __save: unknown[]; __opened: string[] };
    g.__save = [];
    g.__opened = [];
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      g.__save.push(args.length === 2 ? args[1] : args[0]);
      return { canceled: a.canceled, filePath: a.filePath ?? '' };
    }) as typeof dialog.showSaveDialog;
    shell.openPath = async (p: string) => {
      g.__opened.push(p);
      return '';
    };
  }, answer);
  return {
    asked: () => app.evaluate(() => (globalThis as unknown as { __save: Array<{ defaultPath: string; filters: Array<{ extensions: string[] }> }> }).__save),
    opened: () => app.evaluate(() => (globalThis as unknown as { __opened: string[] }).__opened),
  };
}

test('a worker signs in with email and password and reaches Home', { tag: '@smoke' }, async ({ desktopApp, data }) => {
  const { window } = desktopApp;
  await signIn(window, data.worker.email);
  await expect(window.getByLabel('Timer')).toBeVisible();
  await expect(window.getByRole('button', { name: 'Profile' })).toContainText(data.worker.name);
  await test.info().attach('home', { body: await window.screenshot(), contentType: 'image/png' });
});

test('downloads a pay stub through the main process to where the worker chose', { tag: '@smoke' }, async ({ desktopApp, data }) => {
  const { app, window } = desktopApp;
  await signIn(window, data.worker.email);
  await openPage(window, 'Pay stubs');
  await expect(window.getByRole('listitem').filter({ hasText: usd(data.payStub.netMinor) })).toBeVisible();

  const target = test.info().outputPath('my-pay-stub.pdf');
  const save = await stubSaveDialog(app, { canceled: false, filePath: target });
  await window.getByRole('button', { name: 'PDF' }).click();

  // The file appears before writeFile finishes, and the main process opens it only afterwards: wait for both.
  await expect.poll(() => (existsSync(target) ? readFileSync(target).subarray(0, 5).toString() : '')).toBe('%PDF-');
  const [asked] = await save.asked();
  // Suggested name comes from the server's file name, checked against the expected pattern.
  expect(asked!.defaultPath).toMatch(new RegExp(`pay-stub-${data.payStub.periodStart}\\.pdf$`));
  expect(asked!.filters[0]!.extensions).toEqual(['pdf']);
  await expect.poll(() => save.opened()).toEqual([target]);
  await expect(window.getByText('Could not download the pay stub')).toHaveCount(0);
  await test.info().attach('pay-stubs', { body: await window.screenshot(), contentType: 'image/png' });
});

test('cancelling the Save dialog writes nothing and shows no error', async ({ desktopApp, data }) => {
  const { app, window } = desktopApp;
  await signIn(window, data.worker.email);
  await openPage(window, 'Pay stubs');
  const save = await stubSaveDialog(app, { canceled: true });
  await window.getByRole('button', { name: 'PDF' }).click();
  await expect.poll(async () => (await save.asked()).length).toBe(1);
  expect(await save.opened()).toEqual([]);
  await expect(window.getByRole('button', { name: 'PDF' })).toBeEnabled();
  await expect(window.getByText('Could not download the pay stub')).toHaveCount(0);
});

test('the window has no Node access and the main process rejects invalid requests', async ({ desktopApp, data }) => {
  const { window } = desktopApp;
  await signIn(window, data.worker.email);
  const result = await window.evaluate(async () => {
    const w = window as unknown as { require?: unknown; process?: unknown; ipcRenderer?: unknown; tallywork: { me(r: string): Promise<unknown>; savePayStub(id: string): Promise<unknown> } };
    const fails = async (p: Promise<unknown>) => p.then(() => 'resolved', (e: Error) => e.message);
    return {
      node: [typeof w.require, typeof w.process, typeof w.ipcRenderer],
      bridge: Object.keys(w.tallywork).includes('invoke'),
      badResource: await fails(w.tallywork.me('../orgs/x/workers')),
      badStubId: await fails(w.tallywork.savePayStub('../../orgs/x/payroll/runs')),
    };
  });
  expect(result.node).toEqual(['undefined', 'undefined', 'undefined']);
  expect(result.bridge).toBe(false);
  expect(result.badResource).toContain('Invalid payload for me:get');
  expect(result.badStubId).toContain('Invalid payload for me:savePayStub');
});

test('signing out returns to the sign-in screen', async ({ desktopApp, data }) => {
  const { window } = desktopApp;
  await signIn(window, data.worker.email);
  await window.getByRole('button', { name: 'Profile' }).click();
  await window.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(window.getByRole('heading', { level: 1, name: 'Sign in to start tracking' })).toBeVisible();
});
