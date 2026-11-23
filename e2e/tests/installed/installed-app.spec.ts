import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, signIn } from '../../support/electron';
import { ok, test } from '../../support/fixtures';
import { closeInstalled, installedPath, launchInstalled, type InstalledApp } from '../../support/installed';

/**
 * The desktop app as people get it: built into a real installer, installed silently, and started from
 * where the installer put it (the "Desktop installer" workflow; see support/installed.ts). It signs in
 * as a worker, reports the version that was built, clocks in, shows on the manager's Live page, and
 * clocks out with an end-of-day report.
 */
const VERSION = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/desktop/package.json'), 'utf8')).version as string;

let current: InstalledApp | null = null;

test.skip(!installedPath(), 'Set INSTALLED_APP to an installed desktop app (the Desktop installer workflow does)');

test.afterEach(async () => {
  if (current) await closeInstalled(current);
  current = null;
});

test('the installed app signs in, reports its version, clocks in and out', { tag: '@smoke' }, async ({ data, adminApi }) => {
  test.setTimeout(180_000);
  const { api, orgApi } = adminApi;
  current = await launchInstalled();
  const { window } = current;

  await signIn(window, data.worker.email);
  await expect(window.getByLabel('Timer')).toBeVisible();
  await test.info().attach('installed-home', { body: await window.screenshot().catch(() => Buffer.alloc(0)), contentType: 'image/png' });

  // The server sees this computer with the version that was just built.
  const devices = await ok<Array<{ membership_id: string; agent_version: string | null; last_seen_at: string | null }>>(await api.get(orgApi(`/devices?membership_id=${data.worker.membershipId}`)), 'devices');
  expect(devices.map((d) => d.agent_version)).toContain(VERSION);

  // Clock in: the manager's Live page shows the worker working on that project.
  // A fresh install has no project chosen: choosing one only selects it; Clock in starts tracking.
  const timer = window.getByLabel('Timer');
  await timer.getByLabel('Project').selectOption(data.projects.website.id);
  await timer.getByRole('button', { name: `Clock in to ${data.projects.website.name}` }).click();
  await expect(timer.getByText('Clocked in', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => {
      const live = await ok<Array<{ membership_id: string; status: string; project_name: string | null }>>(await api.get(orgApi('/tracking/live')), 'live');
      const me = live.find((w) => w.membership_id === data.worker.membershipId);
      return me ? `${me.status} ${me.project_name}` : 'absent';
    }, { timeout: 30_000 })
    .toBe(`WORKING ${data.projects.website.name}`);

  // Clock out with an end-of-day report.
  await timer.getByRole('button', { name: 'Clock out' }).click();
  const sheet = window.getByRole('dialog', { name: 'Clock out' });
  await sheet.getByLabel('End-of-day report').fill('Installer check: clocked in and out from the installed app.');
  await sheet.getByRole('button', { name: 'Submit and clock out' }).click();
  await expect(sheet).toBeHidden();
  await expect(timer.getByText('Not clocked in', { exact: true })).toBeVisible();
});
