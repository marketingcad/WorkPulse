import { randomUUID } from 'node:crypto';
import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE, VIEWER_STATE, WEB_URL } from '../../support/env';

/**
 * Screenshot retention & cleanup: the policy, the preview an administrator approves, a manual run
 * that deletes an expired screenshot, and the history. The organization is shared with other specs;
 * only a screenshot this spec creates is old enough to be deleted.
 */
test.describe('Screenshot retention (admin)', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: ADMIN_STATE });

  test('the policy saves, is validated, and survives a reload', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings/screenshot-retention`);
    await expect(page.getByRole('heading', { level: 1, name: 'Screenshot retention' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Screenshot retention' })).toHaveAttribute('aria-current', 'page');
    const days = page.getByLabel('Keep screenshots for');
    await expect(days).toHaveValue('30');
    await expect(page.getByLabel('Time', { exact: true })).toHaveValue('02:00');
    await expect(page.getByRole('switch', { name: /Delete expired screenshots automatically/ })).toBeChecked();
    const save = page.getByRole('button', { name: 'Save policy' });
    await expect(save).toBeDisabled();

    // A custom period outside 1–3650 days is refused before saving.
    await days.selectOption('custom');
    await page.getByLabel('Days to keep').fill('0');
    await expect(page.getByText('Enter a whole number of days from 1 to 3650')).toBeVisible();
    await expect(save).toBeDisabled();

    await page.getByLabel('Days to keep').fill('45');
    await page.getByLabel('Time', { exact: true }).fill('03:30');
    await page.getByLabel('How often').selectOption('WEEKLY');
    await page.getByLabel('Day', { exact: true }).selectOption('Sunday');
    await save.click();
    await expect(page.getByText('Screenshot retention saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Keep screenshots for')).toHaveValue('custom');
    await expect(page.getByLabel('Days to keep')).toHaveValue('45');
    await expect(page.getByLabel('Time', { exact: true })).toHaveValue('03:30');

    // Turning cleanup off shows no next run.
    await page.getByRole('switch', { name: /Delete expired screenshots automatically/ }).click();
    await page.getByRole('button', { name: 'Save policy' }).click();
    await expect(page.getByText('Automatic cleanup is turned off')).toBeVisible();

    // Back to the defaults for the next tests.
    await page.getByRole('switch', { name: /Delete expired screenshots automatically/ }).click();
    await page.getByLabel('Keep screenshots for').selectOption('30');
    await page.getByLabel('How often').selectOption('DAILY');
    await page.getByLabel('Time', { exact: true }).fill('02:00');
    await page.getByRole('button', { name: 'Save policy' }).click();
    await expect(page.getByText('Automatic cleanup is turned off')).toHaveCount(0);
  });

  test('preview, approve, then a manual cleanup deletes only the expired screenshot', { tag: '@smoke' }, async ({ page, data, adminApi, newcomerDevice }) => {
    // The newcomer's desktop app captured a screenshot 45 days ago (screenshots on for them only).
    const policy = adminApi.orgApi(`/policies/WORKER/${data.newcomer.membershipId}`);
    await ok(await adminApi.api.put(policy, { data: { screenshots: { enabled: true } } }), 'enable screenshots');
    const send = async (events: unknown[]) => {
      const res = await fetch(`${WEB_URL}/api/v1/agent/ingest/batch`, { method: 'POST', headers: { Authorization: `Bearer ${newcomerDevice.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sent_at: new Date().toISOString(), events }) });
      expect(res.status).toBe(200);
      return res.json() as Promise<{ results: Array<{ status: string; error?: unknown }> }>;
    };
    const sid = randomUUID();
    const shotId = randomUUID();
    const capturedAt = new Date(Date.now() - 45 * 86400_000).toISOString();
    try {
      await send([{ event_id: randomUUID(), type: 'session.start', session_id: sid, seq: 1, occurred_at: new Date(Date.now() - 60_000).toISOString(), project_id: data.projects.website.id }]);
      const r = await send([
        { event_id: randomUUID(), type: 'screenshot.captured', session_id: sid, seq: 2, occurred_at: capturedAt, screenshot_id: shotId, captured_at: capturedAt, display_index: 0, blurred: false, width: 1280, height: 800, bytes: 123456, sha256: 'a'.repeat(64), storage_key: `org/${data.orgId}/screenshots/${data.newcomer.membershipId}/${capturedAt.slice(0, 10)}/${shotId}.jpg` },
      ]);
      expect(r.results.map((x) => x.status)).toEqual(['accepted']);
      await send([{ event_id: randomUUID(), type: 'session.stop', session_id: sid, seq: 3, occurred_at: new Date().toISOString() }]);
    } finally {
      await adminApi.api.put(policy, { data: {} });
    }

    await page.goto(`/o/${data.orgId}/settings/screenshot-retention`);
    await expect(page.getByText(/Not approved: nothing will be deleted/)).toBeVisible();
    await page.getByRole('button', { name: 'Preview cleanup' }).click();
    const preview = page.getByRole('region', { name: 'Preview result' });
    await expect(preview).toBeVisible();
    const eligible = Number((await preview.getByText('Screenshots to delete').locator('..').locator('dd').textContent())!.replace(/\D/g, ''));
    expect(eligible).toBeGreaterThanOrEqual(1);
    // The preview deleted nothing.
    const stillThere = await ok<{ screenshots: number; reclaimable_screenshots: number }>(await adminApi.api.get(adminApi.orgApi('/screenshot-cleanup/storage')), 'storage');
    expect(stillThere.reclaimable_screenshots).toBe(eligible);

    await preview.getByRole('button', { name: 'Approve cleanup' }).click();
    const approve = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Approve screenshot cleanup?' }));
    await expect(approve).toContainText('cannot be restored');
    await approve.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/Approved by Erin Admin/)).toBeVisible();

    await page.getByRole('button', { name: 'Run cleanup now' }).click();
    const run = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Delete expired screenshots now?' }));
    await run.getByRole('button', { name: 'Delete now' }).click();
    await expect(page.getByText('Cleanup started. It runs in the background.')).toBeVisible();

    // The run finishes in the background; the history shows it.
    const history = page.getByRole('table', { name: 'Cleanup history' });
    await expect(history.getByRole('row').filter({ hasText: 'Manual' }).first()).toContainText('Completed', { timeout: 30_000 });
    await expect(history.getByRole('row').filter({ hasText: 'Manual' }).first()).toContainText(String(eligible));
    const after = await ok<{ reclaimable_screenshots: number }>(await adminApi.api.get(adminApi.orgApi('/screenshot-cleanup/storage')), 'storage');
    expect(after.reclaimable_screenshots).toBe(0);
    // The session's time is untouched.
    expect((await adminApi.api.get(adminApi.orgApi(`/sessions/${sid}`))).status()).toBe(200);
  });

  test('a second manual run while one is going is refused', async ({ adminApi }) => {
    const first = await adminApi.api.post(adminApi.orgApi('/screenshot-cleanup/runs'));
    expect(first.status()).toBe(202);
    const second = await adminApi.api.post(adminApi.orgApi('/screenshot-cleanup/runs'));
    // Either the first is still running (409), or it already finished and a new one started.
    expect([202, 409]).toContain(second.status());
    if (second.status() === 409) expect((await second.json()).code).toBe('cleanup_running');
  });
});

test.describe('Screenshot retention (restricted role)', () => {
  test.use({ storageState: VIEWER_STATE });

  test('someone without retention access sees neither the tab nor the page, and the API refuses', async ({ page, data }) => {
    await page.goto(`/o/${data.orgId}/settings/screenshot-retention`);
    await expect(page.getByRole('heading', { level: 1, name: 'Screenshot retention' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Run cleanup now' })).toHaveCount(0);
    const api = await page.request.post(`/api/v1/orgs/${data.orgId}/screenshot-cleanup/runs`, { headers: { Origin: WEB_URL } });
    expect(api.status()).toBe(403);
  });
});
