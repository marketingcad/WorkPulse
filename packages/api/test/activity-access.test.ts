import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

/**
 * Who may see activity, screenshots and app or website usage (full QA pass, feature 9). Monitoring
 * data is the most sensitive data WorkPulse holds: a worker sees only their own, a team manager only
 * their team's, and deleting is a separate permission. Every refusal of something that exists is a
 * 404, so it does not tell anyone the capture exists. Recorded rows stand in for the desktop app;
 * capturing them is covered in multi-monitor.test.ts and the agent tests.
 */
let t: Harness;
let admin: Client;
let orgId: string;
let manager: Client;
let w1: { client: Client; membershipId: string };
let w2: { client: Client; membershipId: string };
let outsider: Client;
let shot1: string;
let shot2: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

// 20:30 UTC on 12 Nov is 3:30 PM in New York (12 Nov) and 4:30 AM in Manila (13 Nov).
const AT = new Date('2026-11-12T20:30:00Z');
const NY_DAY = '2026-11-12';
const MANILA_DAY = '2026-11-13';

/** One session with a 10-minute window, a screenshot, an app span and a website span. */
async function record(membershipId: string, projectId: string, app: string, domain: string): Promise<string> {
  const session = newId();
  const shot = newId();
  await withSystem(t.h.db, async (tx) => {
    await tx.execute(sql`insert into tracking_sessions (id, organization_id, membership_id, source, project_id, state, started_at, ended_at, timezone)
      values (${session}::uuid, ${orgId}::uuid, ${membershipId}::uuid, 'DESKTOP', ${projectId}::uuid, 'STOPPED', ${AT}, ${new Date(AT.getTime() + 600_000)}, 'UTC')`);
    await tx.execute(sql`insert into activity_windows (organization_id, membership_id, window_start, session_id, project_id, active_seconds, tracked_seconds, keyboard_count, mouse_count, activity_pct, keyboard_pct, mouse_pct, local_date)
      values (${orgId}::uuid, ${membershipId}::uuid, ${AT}, ${session}::uuid, ${projectId}::uuid, 450, 600, 300, 500, 75, 50, 70, ${NY_DAY})`);
    await tx.execute(sql`insert into screenshots (id, organization_id, session_id, membership_id, captured_at, storage_key, status, window_start)
      values (${shot}::uuid, ${orgId}::uuid, ${session}::uuid, ${membershipId}::uuid, ${new Date(AT.getTime() + 120_000)}, ${`test/${shot}`}, 'READY', ${AT})`);
    await tx.execute(sql`insert into app_spans (id, organization_id, session_id, membership_id, client_span_id, app_name, started_at, ended_at, duration_seconds)
      values (gen_random_uuid(), ${orgId}::uuid, ${session}::uuid, ${membershipId}::uuid, ${newId()}, ${app}, ${AT}, ${new Date(AT.getTime() + 300_000)}, 300)`);
    await tx.execute(sql`insert into url_spans (id, organization_id, session_id, membership_id, client_span_id, domain, started_at, ended_at, duration_seconds)
      values (gen_random_uuid(), ${orgId}::uuid, ${session}::uuid, ${membershipId}::uuid, ${newId()}, ${domain}, ${AT}, ${new Date(AT.getTime() + 300_000)}, 300)`);
  });
  return shot;
}

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-13T12:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@activity-access.test'));
  w1 = await addMember(t, admin, orgId, 'Walt', 'walt@activity-access.test');
  w2 = await addMember(t, admin, orgId, 'Wren', 'wren@activity-access.test');
  const mgr = await addMember(t, admin, orgId, 'Mia', 'mia@activity-access.test', 'TEAM_MANAGER');
  manager = mgr.client;
  const team = (await admin.post(o('/teams'), { name: 'Design' })).body.id as string;
  expect((await admin.put(o(`/teams/${team}/members/${mgr.membershipId}`), { role: 'MANAGER' })).status).toBe(200);
  expect((await admin.put(o(`/teams/${team}/members/${w1.membershipId}`), { role: 'MEMBER' })).status).toBe(200);
  const project = (await admin.post(o('/projects'), { name: 'Site', member_ids: [w1.membershipId, w2.membershipId] })).body.id as string;
  // Walt works in New York, Wren in Manila: their days start at different instants.
  await withSystem(t.h.db, (tx) => tx.execute(sql`update worker_profiles set timezone = case membership_id when ${w1.membershipId}::uuid then 'America/New_York' else 'Asia/Manila' end where membership_id in (${w1.membershipId}::uuid, ${w2.membershipId}::uuid)`));
  shot1 = await record(w1.membershipId, project, 'WaltEditor', 'walt.example');
  shot2 = await record(w2.membershipId, project, 'WrenSecretApp', 'wren-secret.example');
  ({ client: outsider } = await signup(t, 'Olga', 'olga@activity-access.test'));
}, 60_000);
afterAll(() => t.close());

const range = `from=${NY_DAY}&to=${MANILA_DAY}`;
const owners = (rows: Array<{ membership_id: string }>) => [...new Set(rows.map((r) => r.membership_id))];

describe('a worker sees only their own monitoring data', () => {
  it('their own day, not a colleague’s', async () => {
    expect((await w1.client.get(o(`/activity/day?date=${NY_DAY}`))).status).toBe(200);
    expect((await w1.client.get(o(`/activity/day?membership_id=${w2.membershipId}&date=${MANILA_DAY}`))).status).toBe(404);
  });

  it('their own screenshots only, and a colleague’s screenshot is invisible and cannot be deleted', async () => {
    expect(owners((await w1.client.get(o(`/screenshots?${range}`))).body)).toEqual([w1.membershipId]);
    expect((await w1.client.get(o(`/screenshots/${shot2}`))).status).toBe(404);
    expect((await w1.client.del(o(`/screenshots/${shot2}`))).status).toBe(404);
    expect(owners((await admin.get(o(`/screenshots?${range}`))).body)).toContain(w2.membershipId);
  });

  it('their own apps and websites only', async () => {
    const apps = JSON.stringify((await w1.client.get(o(`/apps?${range}&membership_ids=${w2.membershipId}`))).body);
    expect(apps).not.toContain('WrenSecretApp');
    expect((await w1.client.get(o(`/apps/spans?membership_id=${w2.membershipId}&date=${MANILA_DAY}`))).status).toBe(404);
    expect((await w1.client.get(o(`/urls/spans?membership_id=${w2.membershipId}&date=${MANILA_DAY}`))).status).toBe(404);
  });
});

describe('a team manager sees their team only, and cannot delete', () => {
  it('a team member’s day and screenshots, not anyone else’s', async () => {
    expect((await manager.get(o(`/activity/day?membership_id=${w1.membershipId}&date=${NY_DAY}`))).status).toBe(200);
    expect((await manager.get(o(`/activity/day?membership_id=${w2.membershipId}&date=${MANILA_DAY}`))).status).toBe(404);
    const shots = owners((await manager.get(o(`/screenshots?${range}`))).body);
    expect(shots).toContain(w1.membershipId);
    expect(shots).not.toContain(w2.membershipId);
    expect((await manager.get(o(`/screenshots/${shot2}`))).status).toBe(404);
    expect((await manager.get(o(`/screenshots/${shot1}`))).status).toBe(200);
  });

  it('no usage of people outside the team', async () => {
    expect(JSON.stringify((await manager.get(o(`/apps?${range}`))).body)).not.toContain('WrenSecretApp');
    expect(JSON.stringify((await manager.get(o(`/urls?${range}`))).body)).not.toContain('wren-secret.example');
    expect((await manager.get(o(`/apps/spans?membership_id=${w2.membershipId}&date=${MANILA_DAY}`))).status).toBe(404);
  });

  it('cannot delete a team member’s screenshot', async () => {
    expect((await manager.del(o(`/screenshots/${shot1}`))).status).toBe(403);
    expect((await admin.get(o(`/screenshots/${shot1}`))).status).toBe(200);
  });
});

describe('the organization’s admin', () => {
  it('opens anyone’s screenshot, and the look is recorded', async () => {
    expect((await admin.get(o(`/screenshots/${shot2}`))).status).toBe(200);
    const log = (await admin.get(o(`/audit-logs?action=screenshot.viewed`))).body as Array<{ target_id: string }>;
    expect(log.map((l) => l.target_id)).toContain(shot2);
  });
});

describe('another organization', () => {
  it('reaches none of it', async () => {
    for (const path of [`/activity/day?membership_id=${w1.membershipId}&date=${NY_DAY}`, `/screenshots?${range}`, `/screenshots/${shot1}`, `/apps/spans?membership_id=${w1.membershipId}&date=${NY_DAY}`]) {
      expect((await outsider.get(o(path))).status, path).toBe(404);
    }
  });
});

describe('a day is the member’s own calendar day', () => {
  it('in their time zone: the same instant is 12 Nov in New York and 13 Nov in Manila', async () => {
    const blocks = async (id: string, date: string) => ((await admin.get(o(`/activity/day?membership_id=${id}&date=${date}`))).body as { blocks: unknown[]; timezone: string });
    const walt12 = await blocks(w1.membershipId, NY_DAY);
    expect(walt12.timezone).toBe('America/New_York');
    expect(walt12.blocks).toHaveLength(1);
    const wren13 = await blocks(w2.membershipId, MANILA_DAY);
    expect(wren13.timezone).toBe('Asia/Manila');
    expect(wren13.blocks).toHaveLength(1);
    expect((await blocks(w2.membershipId, NY_DAY)).blocks).toHaveLength(0);
    expect(((await admin.get(o(`/apps/spans?membership_id=${w2.membershipId}&date=${MANILA_DAY}`))).body as unknown[]).length).toBe(1);
    expect(((await admin.get(o(`/apps/spans?membership_id=${w2.membershipId}&date=${NY_DAY}`))).body as unknown[]).length).toBe(0);
  });
});
