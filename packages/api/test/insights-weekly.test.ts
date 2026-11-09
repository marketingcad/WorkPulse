import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { notifications, withTenant } from '@tallywork/db';
import { startOfWeek } from '@tallywork/domain';
import { sendWeeklyInsights } from '../src/services/insights-weekly';
import { insightCache } from '../src/services/ai-insights/cache';
import { addMember, createHarness, signup, type Client, type Harness } from './harness';

/**
 * Weekly "needs your attention" summary: built from AI Insights findings (computed, no AI), sent once
 * per member per week on the organization's first day of the week, in-app, and by email only when
 * the member opted in. Org: Ada (admin); Walt worked last week and did not submit his timesheet.
 */
let t: Harness;
let orgId: string;
let ada: Client;
let adaId: string;
let walt: { client: Client; membershipId: string };
let weekStartDay: string;
let zedOrg: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const weekly = (org: string, day: string) => withTenant(t.deps.db, org, (tx) => sendWeeklyInsights(tx, t.deps, org, day));
const mine = (org: string, membershipId: string) =>
  withTenant(t.deps.db, org, (tx) => tx.select().from(notifications).where(and(eq(notifications.membershipId, membershipId), eq(notifications.type, 'insights.weekly'))));

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-09T15:00:00Z'));
  ({ client: ada, orgId } = await signup(t, 'Ada', 'ada@w.test'));
  walt = await addMember(t, ada, orgId, 'Walt Worker', 'walt@w.test');
  const org = (await ada.get<any>(o(''))).body;
  adaId = org.membership.id;
  const p = (await ada.post<any>(o('/projects'), { name: 'Alpha', member_ids: [walt.membershipId] })).body.id as string;
  await ada.post(o('/manual-time'), { membership_id: walt.membershipId, project_id: p, started_at: '2026-11-03T14:00:00Z', ended_at: '2026-11-03T17:00:00Z', reason: 'Entered by admin' });
  weekStartDay = startOfWeek('2026-11-09', org.organization.week_start);
  zedOrg = (await signup(t, 'Zed', 'zed@w.test', 'Quiet Org')).orgId;
  insightCache.clear();
});
afterAll(() => t.close());

describe('weekly AI Insights summary', () => {
  it('sends the admin one summary on the first day of the week, linking to last week, and emails only if opted in', async () => {
    expect((await ada.put(o('/notification-preferences'), { preferences: [{ type: 'insights.weekly', in_app: true, email: true }] })).status).toBe(200);
    const before = t.mailer.sent.length;
    expect(await weekly(orgId, weekStartDay)).toBeGreaterThanOrEqual(1);
    const rows = await mine(orgId, adaId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toMatch(/^\d+ (thing needs|things need) your attention this week$/);
    expect(rows[0]!.body).toContain('not been submitted');
    expect(rows[0]!.link).toBe('/ai-insights?period=last_week');
    expect(t.mailer.sent.length).toBe(before + 1);
  });

  it('is sent once per week, even when the daily job runs again', async () => {
    await weekly(orgId, weekStartDay);
    expect(await mine(orgId, adaId)).toHaveLength(1);
  });

  it('is not sent on other days, to people who cannot use AI Insights, or when nothing needs attention', async () => {
    expect(await weekly(orgId, '2026-11-10' === weekStartDay ? '2026-11-11' : '2026-11-10')).toBe(0);
    expect(await mine(orgId, walt.membershipId)).toHaveLength(0);
    expect(await weekly(zedOrg, weekStartDay)).toBe(0);
  });
});

describe('weekly summary: final review fixes', () => {
  it('I1: one member failing never undoes or re-sends another member’s summary', async () => {
    const { client: lead, orgId: org2 } = await signup(t, 'Lia', 'lia@w2.test', 'Second Org');
    const sam = await addMember(t, lead, org2, 'Sam Admin', 'sam@w2.test', 'SYSTEM_ADMIN');
    const wade = await addMember(t, lead, org2, 'Wade Worker', 'wade@w2.test');
    const p = (await lead.post<any>(`/orgs/${org2}/projects`, { name: 'Beta', member_ids: [wade.membershipId] })).body.id as string;
    await lead.post(`/orgs/${org2}/manual-time`, { membership_id: wade.membershipId, project_id: p, started_at: '2026-11-03T14:00:00Z', ended_at: '2026-11-03T17:00:00Z', reason: 'Entered by admin' });
    expect((await lead.put(`/orgs/${org2}/notification-preferences`, { preferences: [{ type: 'insights.weekly', in_app: true, email: true }] })).status).toBe(200);
    const liaId = (await lead.get<any>(`/orgs/${org2}`)).body.membership.id as string;
    insightCache.clear();
    const { getInsights } = await import('../src/services/ai-insights');
    const failing: typeof getInsights = async (x, s, q) => {
      if (x.actor.membershipId === sam.membershipId) throw new Error('boom');
      return getInsights(x, s, q);
    };
    const mails = t.mailer.sent.length;
    const run = () => withTenant(t.deps.db, org2, (tx) => sendWeeklyInsights(tx, t.deps, org2, weekStartDay, failing));
    await run();
    await run();
    expect(await mine(org2, liaId)).toHaveLength(1);
    expect(await mine(org2, sam.membershipId)).toHaveLength(0);
    expect(t.mailer.sent.length).toBe(mails + 1);
  });
});
