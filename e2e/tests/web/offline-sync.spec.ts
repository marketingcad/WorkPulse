import { randomUUID } from 'node:crypto';
import { request } from '@playwright/test';
import { expect, ok, test } from '../../support/fixtures';
import { ADMIN_STATE, PASSWORD, WEB_URL } from '../../support/env';

/**
 * Audit 28 Oct 2026, phase 2 (Q6): a desktop session recorded offline and synced late used to end the
 * web timer that was running, and the time since it started was lost. The web timer now keeps running,
 * the offline session is filled in beside it, and nothing is counted twice.
 */
test.use({ storageState: ADMIN_STATE });

test('a running web timer survives a late desktop sync, and the offline time is kept', { tag: '@smoke' }, async ({ page, data, adminApi, newcomerDevice }) => {
  // The newcomer runs a web timer…
  const web = await request.newContext({ baseURL: WEB_URL, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: { Origin: WEB_URL } });
  await ok(await web.post('/api/v1/auth/login', { data: { email: data.newcomer.email, password: PASSWORD } }), 'newcomer sign-in');
  const track = (path: string, body?: object) => web.post(`/api/v1/orgs/${data.orgId}/tracking/${path}`, body ? { data: body } : {});
  await track('stop');
  const started = await ok<{ session: { id: string; source: string } }>(await track('start', { project_id: data.projects.website.id }), 'web start');
  expect(started.session.source).toBe('WEB');

  // …while their desktop app, offline, recorded half an hour of work three hours ago. It syncs now.
  const start = new Date(Date.now() - 3 * 3600_000);
  const sid = randomUUID();
  const res = await fetch(`${WEB_URL}/api/v1/agent/ingest/batch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${newcomerDevice.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sent_at: new Date().toISOString(),
      events: [
        { event_id: randomUUID(), type: 'session.start', session_id: sid, seq: 1, occurred_at: start.toISOString(), project_id: data.projects.website.id },
        { event_id: randomUUID(), type: 'session.stop', session_id: sid, seq: 2, occurred_at: new Date(start.getTime() + 30 * 60_000).toISOString() },
      ],
    }),
  });
  const sync = await res.json();
  expect(sync.results.map((r: { status: string }) => r.status)).toEqual(['accepted', 'accepted']);
  expect(sync.session?.id).toBe(started.session.id); // the running timer is still the web one

  // The admin's Live page still shows the newcomer working (they were shown offline before the fix).
  await page.goto(`/o/${data.orgId}/tracking/live`);
  await expect(page.getByRole('row').filter({ hasText: data.newcomer.name })).toContainText('Working');

  const current = await ok<{ session: { id: string; state: string } | null }>(await web.get(`/api/v1/orgs/${data.orgId}/tracking/current`), 'current');
  expect(current.session).toMatchObject({ id: started.session.id, state: 'ACTIVE' });
  await ok(await track('stop'), 'web stop');
  await web.dispose();
  // The offline half hour is kept in full.
  const from = new Date(start.getTime() - 86400_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const entries = await ok<Array<{ session_id: string | null; duration_seconds: number }>>(
    await adminApi.api.get(adminApi.orgApi(`/time-entries?from=${from}&to=${to}&membership_ids=${data.newcomer.membershipId}`)),
    'entries',
  );
  expect(entries.filter((e) => e.session_id === sid).reduce((s, e) => s + e.duration_seconds, 0)).toBe(30 * 60);
});
