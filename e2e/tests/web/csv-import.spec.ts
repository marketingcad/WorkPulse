import type { Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/** CSV time import on "My timesheet": file → checked preview → rows sent as manual time. */
test.use({ storageState: ADMIN_STATE });

/** A past day (UTC, like the test browser) whose early-morning slots are certainly in the past. */
function importDay(): string {
  const d = new Date(Date.now() - 36 * 3600_000);
  return d.toISOString().slice(0, 10);
}

async function openImport(page: Page, orgId: string, day: string) {
  await page.goto(`/o/${orgId}/timesheets?date=${day}`);
  await expect(page.getByRole('heading', { level: 1, name: 'My timesheet' })).toBeVisible();
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import time from CSV' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const file = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });

test('checks every row, imports only the valid ones, and shows them on the timesheet', { tag: '@smoke' }, async ({ page, data }) => {
  const day = importDay();
  // Separate slots per retry, so a CI retry never overlaps entries from its first attempt.
  const h = (n: number) => String(n + test.info().retry * 4).padStart(2, '0');
  const note = `E2E import ${data.run}`;
  const csv = [
    'Date,Start,End,Project,Task,Note,Type',
    `${day},${h(1)}:00,${h(1)}:45,${data.projects.website.name},,${note} A,`,
    `${day},${h(2)}:00,${h(3)}:30,${data.projects.app.name.toUpperCase()},,${note} B,`,
    `2026-02-30,09:00,10:00,${data.projects.website.name},,impossible date,`,
    `${day},09:00,10:00,Intranet,,unknown project,`,
    `${day},11:00,10:00,${data.projects.website.name},,ends before it starts,`,
  ].join('\r\n');

  const dialog = await openImport(page, data.orgId, day);
  await dialog.locator('input[type=file]').setInputFiles(file('week.csv', csv));
  await expect(dialog.getByText('week.csv')).toBeVisible();

  const table = dialog.getByRole('table', { name: 'Rows to import' });
  const row = (line: number) => table.getByRole('row').filter({ has: page.getByRole('cell', { name: String(line), exact: true }) });
  await expect(row(2)).toContainText('Ready');
  await expect(row(3)).toContainText('Ready'); // project names match regardless of case
  await expect(row(4)).toContainText('Date must be YYYY-MM-DD');
  await expect(row(5)).toContainText('No project “Intranet” you can log to');
  await expect(row(6)).toContainText('End must be after start');
  await test.info().attach('csv-preview', { body: await page.screenshot(), contentType: 'image/png' });

  await dialog.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect(row(2)).toContainText(/Added|Requested/);
  await expect(row(3)).toContainText(/Added|Requested/);
  await expect(page.getByText('2 entries imported')).toBeVisible();
  // Nothing left to import; invalid rows were never sent.
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Close' }).first().click();

  await page.getByRole('button', { name: /^Entries/ }).click();
  await expect(page.getByText(`${note} A`)).toBeVisible();
  await expect(page.getByText(`${note} B`)).toBeVisible();
  await expect(page.getByText('impossible date')).toHaveCount(0);
});

test('offers a template that it reads back as a valid row', async ({ page, data }) => {
  const dialog = await openImport(page, data.orgId, importDay());
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Template' }).click()]);
  expect(download.suggestedFilename()).toBe('time-import-template.csv');
  const text = (await (await import('node:fs/promises')).readFile(await download.path())).toString('utf8');
  expect(text.replace(/^﻿/, '').split(/\r?\n/)[0]).toBe('Date,Start,End,Project,Task,Note,Type');

  await dialog.locator('input[type=file]').setInputFiles(file('time-import-template.csv', text));
  await expect(dialog.getByRole('table', { name: 'Rows to import' })).toContainText('Ready');
  await expect(dialog.getByRole('button', { name: 'Import 1 row' })).toBeEnabled();
});

test('refuses files that are too large', async ({ page, data }) => {
  const dialog = await openImport(page, data.orgId, importDay());
  await dialog.locator('input[type=file]').setInputFiles(file('huge.csv', 'Date,Start,End,Project\n' + 'x'.repeat(600 * 1024)));
  await expect(dialog.getByRole('alert')).toHaveText('Use a file under 512 KB');
  await expect(dialog.getByRole('table', { name: 'Rows to import' })).toHaveCount(0);
});
