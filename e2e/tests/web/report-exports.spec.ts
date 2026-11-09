import { readFileSync } from 'node:fs';
import { request, type Page } from '@playwright/test';
import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE, MANAGER_STATE, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * Report library exports. The CSV download and saving a schedule are covered in
 * qa/settings-integrations.spec.ts; this adds the real file contents of each format, the
 * background export, and who may see and export which report.
 */

async function openTimeActivity(page: Page, orgId: string) {
  await page.goto(`/o/${orgId}/reports`);
  await page.getByRole('link', { name: /Time & activity/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Time & activity' })).toBeVisible();
  // Export is offered once the report has run.
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
}

async function download(page: Page, item: string) {
  await page.getByRole('button', { name: 'Export' }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: item, exact: true }).click();
  const file = await pending;
  return { name: file.suggestedFilename(), bytes: readFileSync((await file.path())!) };
}

test.describe('Report exports (system admin)', () => {
  test.use({ storageState: ADMIN_STATE });

  test('CSV, Excel and PDF downloads are real files of that kind', { tag: '@smoke' }, async ({ page, data }) => {
    await openTimeActivity(page, data.orgId);

    const csv = await download(page, 'CSV');
    expect(csv.name).toMatch(/^time-activity_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
    const header = csv.bytes.toString('utf8').replace(/^﻿/, '').split(/\r?\n/)[0]!;
    for (const column of ['Tracked', 'Manual', 'Total', 'Billable']) expect(header).toContain(column);

    const xlsx = await download(page, 'Excel (XLSX)');
    expect(xlsx.name).toMatch(/\.xlsx$/);
    expect(xlsx.bytes.subarray(0, 2).toString('latin1')).toBe('PK'); // an Office Open XML (zip) file

    const pdf = await download(page, 'PDF');
    expect(pdf.name).toMatch(/\.pdf$/);
    expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await expect(page.getByRole('alert').filter({ hasText: /could not|failed/i })).toHaveCount(0);
  });

  test('an export in the background shows up under Recent exports', async ({ page, data, adminApi }) => {
    const before = (await ok<Array<{ id: string }>>(await adminApi.api.get(adminApi.orgApi('/report-runs')), 'runs')).map((r) => r.id);
    await openTimeActivity(page, data.orgId);
    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('menuitem', { name: 'Excel in the background' }).click();
    await expect(page.getByText('Export started — you’ll be notified when it’s ready')).toBeVisible();

    // The run is queued, then finishes on the server.
    let runId = '';
    await expect
      .poll(
        async () => {
          const runs = await ok<Array<{ id: string; status: string; format: string }>>(await adminApi.api.get(adminApi.orgApi('/report-runs')), 'runs');
          const mine = runs.find((r) => !before.includes(r.id) && r.format === 'XLSX');
          runId = mine?.id ?? '';
          return mine?.status ?? 'missing';
        },
        { timeout: 60_000 },
      )
      .toBe('DONE');
    expect(runId).not.toBe('');

    // The toast's link opens the library at Recent exports, with the file ready to download.
    await page.goto(`/o/${data.orgId}/reports?runs=1`);
    const recent = page.getByRole('region', { name: 'Recent exports' }).or(page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Recent exports' }) }).last());
    await expect(recent.getByRole('link', { name: /Download/ }).or(recent.getByRole('button', { name: /Download/ })).first()).toBeVisible();
  });
});

test.describe('Who may see and export which report', () => {
  test('a team manager sees fewer reports, and cannot export one they are not offered', async ({ browser, data, adminApi }) => {
    const managerApi = await request.newContext({ baseURL: WEB_URL, storageState: MANAGER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    const all = await ok<Array<{ key: string; title: string; hidden: boolean }>>(await adminApi.api.get(adminApi.orgApi('/reports')), 'admin catalog');
    const theirs = await ok<Array<{ key: string }>>(await managerApi.get(`/api/v1/orgs/${data.orgId}/reports`), 'manager catalog');
    const notTheirs = all.filter((r) => !r.hidden && !theirs.some((t) => t.key === r.key));
    // Money reports (payroll, invoices, payments) are not a team manager's.
    expect(notTheirs.length).toBeGreaterThan(0);
    const blocked = notTheirs[0]!;

    const ctx = await browser.newContext({ storageState: MANAGER_STATE });
    const page = await ctx.newPage();
    await page.goto(`/o/${data.orgId}/reports`);
    await expect(page.getByRole('heading', { level: 1, name: 'Report library' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Time & activity/ }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(`^${blocked.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })).toHaveCount(0);

    const today = new Date().toISOString().slice(0, 10);
    const res = await managerApi.post(`/api/v1/orgs/${data.orgId}/reports/${blocked.key}/export`, { data: { format: 'CSV', from: today, to: today } });
    expect(res.status()).toBe(403);
    await Promise.all([managerApi.dispose(), ctx.close()]);
  });

  test('a custom role without report access is told so, and the API refuses an export', async ({ browser, data }) => {
    const ctx = await browser.newContext({ storageState: VIEWER_STATE });
    const page = await ctx.newPage();
    await page.goto(`/o/${data.orgId}/reports`);
    await expect(page.getByText('Restricted')).toBeVisible();
    const api = await request.newContext({ baseURL: WEB_URL, storageState: VIEWER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    const today = new Date().toISOString().slice(0, 10);
    expect((await api.post(`/api/v1/orgs/${data.orgId}/reports/time-activity/export`, { data: { format: 'CSV', from: today, to: today } })).status()).toBe(403);
    await Promise.all([api.dispose(), ctx.close()]);
  });
});
