import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { newId } from '@tallywork/domain';
import { runDaily } from '../src/jobs';
import { processReportRuns } from '../src/services/report-runs';
import { Client, addMember, createHarness, signup, type Harness } from './harness';

// AI assistant data: the AI_CONVERSATIONS retention class, the personal data export and erasure.
let t: Harness;
let admin: Client;
let ben: Client;
let benId: string;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;
const DAY = 86400_000;

async function asOwner<T>(q: ReturnType<typeof sql>): Promise<T[]> {
  await t.h.db.execute(sql`reset role`);
  try {
    return ((await t.h.db.execute(q)) as unknown as { rows: T[] }).rows;
  } finally {
    await t.h.db.execute(sql`set role tallywork_app`);
  }
}
/** A conversation whose last message was `daysAgo` days before the (frozen) clock. */
async function conversation(membershipId: string, title: string, daysAgo: number, lastMessage = true) {
  const id = newId();
  const at = new Date(t.clock.now.getTime() - daysAgo * DAY).toISOString();
  await asOwner(sql`insert into assistant_conversations (id, organization_id, membership_id, title, created_at, updated_at, last_message_at) values (${id}, ${orgId}, ${membershipId}, ${title}, ${at}, ${at}, ${lastMessage ? at : null})`);
  await asOwner(sql`insert into assistant_messages (id, organization_id, conversation_id, role, content, created_at) values (${newId()}, ${orgId}, ${id}, 'user', ${`question in ${title}`}, ${at})`);
  return id;
}
const titles = async () => (await asOwner<{ title: string }>(sql`select title from assistant_conversations where organization_id = ${orgId} order by title`)).map((r) => r.title);
const messageCount = async () => (await asOwner<{ n: number }>(sql`select count(*)::int n from assistant_messages where organization_id = ${orgId}`))[0]!.n;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-09-23T20:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@ai.test'));
  ({ client: ben, membershipId: benId } = await addMember(t, admin, orgId, 'Ben', 'ben@ai.test'));
});
afterAll(() => t.close());

describe('AI conversations retention', () => {
  it('a newly signed-up organization keeps AI conversations 90 days', async () => {
    const p = (await admin.get(o('/retention-policies'))).body.find((x: { data_class: string }) => x.data_class === 'AI_CONVERSATIONS');
    expect(p).toMatchObject({ keep_days: 90, purged_automatically: true });
  });

  it('the daily job deletes conversations past the keep period and their messages, and keeps newer ones', async () => {
    await conversation(benId, 'old', 91);
    await conversation(benId, 'recent', 89);
    await conversation(benId, 'never-messaged-old', 120, false); // falls back to created_at
    const summary = (await runDaily(t.deps)) as Record<string, { deleted: Record<string, number> }>;
    expect(summary[orgId]!.deleted.assistant_conversations).toBe(2);
    expect(await titles()).toEqual(['recent']);
    expect(await messageCount()).toBe(1);
  });

  it('only deletes the organization being processed', async () => {
    const other = await signup(t, 'Zed', 'zed@ai.test');
    const [m] = await asOwner<{ id: string }>(sql`select id from memberships where organization_id = ${other.orgId}`);
    const id = newId();
    const at = new Date(t.clock.now.getTime() - 200 * DAY).toISOString();
    await asOwner(sql`insert into assistant_conversations (id, organization_id, membership_id, title, created_at, updated_at, last_message_at) values (${id}, ${other.orgId}, ${m!.id}, 'zed-old', ${at}, ${at}, ${at})`);
    // zed keeps AI conversations for a year; the other organization's 90 days must not reach zed's data
    await asOwner(sql`update retention_policies set keep_days = 365 where organization_id = ${other.orgId} and data_class = 'AI_CONVERSATIONS'`);
    await runDaily(t.deps);
    const rows = await asOwner<{ title: string }>(sql`select title from assistant_conversations where organization_id = ${other.orgId}`);
    expect(rows.map((r) => r.title)).toEqual(['zed-old']);
  });
});

describe('AI conversations and personal data', () => {
  it('the personal data export contains the member’s conversations and messages', async () => {
    await asOwner(sql`delete from assistant_conversations where organization_id = ${orgId}`);
    await conversation(benId, 'Export me', 1);
    const adminId = (await admin.get(o(''))).body.membership.id;
    await conversation(adminId, 'Admin only', 1);
    expect((await ben.post(o(`/workers/${benId}/data-export`))).status).toBe(202);
    await processReportRuns(t.deps);
    const [run] = (await ben.get(o('/report-runs'))).body;
    const file = await new Client(t).get(run.download_url.replace('/api/v1', ''));
    const data = file.body as { assistant_conversations: Array<{ title: string; created_at: string; messages: Array<{ role: string; content: string; created_at: string }> }> };
    expect(data.assistant_conversations).toHaveLength(1);
    expect(data.assistant_conversations[0]).toMatchObject({ title: 'Export me', messages: [{ role: 'user', content: 'question in Export me' }] });
    expect(JSON.stringify(data)).not.toContain('Admin only');
  });

  it('erasing a member deletes their conversations, not others’', async () => {
    const r = await admin.post(o(`/workers/${benId}/anonymize`));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ deleted: { assistant_conversations: 1 } });
    expect(await titles()).toEqual(['Admin only']);
    expect(await messageCount()).toBe(1);
  });
});
