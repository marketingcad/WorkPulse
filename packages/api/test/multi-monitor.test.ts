import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@tallywork/domain';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/**
 * A worker with three monitors sends one capture as three screenshots with the same captured_at and
 * display_index 0, 1 and 2 (apps/desktop/test/multi-monitor.test.ts). The server keeps all three in
 * that 10-minute block, each with its own picture and blur flag, shows them to whoever may see the
 * worker's screenshots, keeps them out of the device's own view, and stores a resent batch once.
 */
let t: Harness;
let admin: Client;
let orgId: string;
let worker: Client;
let workerId: string;
let device: Client;
let batch: { sent_at: string; events: unknown[] };
let shotIds: string[];
let day: string;

const o = (p: string) => `/orgs/${orgId}${p}`;
type Shot = { id: string; captured_at: string; display_index: number; blurred: boolean; thumb_url: string; full_url: string };
const shotsOf = (body: { blocks: Array<{ screenshots: Shot[] }> }) => body.blocks.flatMap((b) => b.screenshots);

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-04T14:00:00Z'));
  day = '2026-11-04';
  ({ client: admin, orgId } = await signup(t, 'Ada Admin', 'ada@mm.test', 'Three Screens Org'));
  ({ client: worker, membershipId: workerId } = await addMember(t, admin, orgId, 'Walt Worker', 'walt@mm.test'));
  const projectId = (await admin.post(o('/projects'), { name: 'Website', member_ids: [workerId] })).body.id;
  expect((await admin.put(o(`/policies/ORG/${orgId}`), { screenshots: { enabled: true, perTenMinutes: 1, blur: true } })).status).toBe(200);

  const { verifier, challenge } = pkce();
  const code = await worker.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  device = new Client(t);
  device.bearer = (await device.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'Three-screen PC', platform: 'windows', agent_version: '0.2.0' } })).body.access_token;

  const sid = newId();
  const at = (s: number) => new Date(t.clock.now.getTime() + s * 1000).toISOString();
  await device.post('/agent/ingest/batch', { sent_at: at(0), events: [{ event_id: newId(), type: 'session.start', session_id: sid, seq: 1, occurred_at: at(0), project_id: projectId }] });
  await device.post('/agent/heartbeat', { sent_at: at(0), session_id: sid });

  // One capture at 14:02, all three screens.
  const capturedAt = at(120);
  shotIds = [newId(), newId(), newId()];
  const events: unknown[] = [];
  for (const [i, id] of shotIds.entries()) {
    const intent = await device.post('/agent/screenshots/upload-intent', { screenshot_id: id, session_id: sid, captured_at: capturedAt, content_type: 'image/jpeg', bytes: 4 });
    expect(intent.status).toBe(200);
    const [width, height] = [[1920, 1080], [2560, 1440], [2560, 1440]][i]!;
    events.push({ event_id: newId(), type: 'screenshot.captured', session_id: sid, occurred_at: capturedAt, screenshot_id: id, captured_at: capturedAt, display_index: i, blurred: true, width, height, bytes: 4, sha256: String(i).repeat(64), storage_key: intent.body.storage_key });
  }
  t.clock.advance(5 * 60_000);
  batch = { sent_at: at(300), events };
  const sent = await device.post('/agent/ingest/batch', batch);
  expect(sent.body.results.map((r: { status: string }) => r.status)).toEqual(['accepted', 'accepted', 'accepted']);
});
afterAll(() => t.close());

describe('one capture of three monitors', () => {
  it('should_keep_all_three_screens_in_the_same_block_as_screen_1_2_and_3', async () => {
    const r = await admin.get(o(`/activity/day?membership_id=${workerId}&date=${day}`));
    expect(r.status).toBe(200);
    const blocks = (r.body.blocks as Array<{ window_start: string; screenshots: Shot[] }>).filter((b) => b.screenshots.length);
    expect(blocks).toHaveLength(1); // the 14:00–14:10 block
    const shots = [...blocks[0]!.screenshots].sort((a, b) => a.display_index - b.display_index);
    expect(shots.map((s) => s.display_index)).toEqual([0, 1, 2]);
    expect(shots.map((s) => s.id)).toEqual(shotIds);
    expect(new Set(shots.map((s) => s.captured_at)).size).toBe(1);
    // Each screen has its own picture, and each was blurred on the computer.
    expect(new Set(shots.map((s) => s.full_url)).size).toBe(3);
    expect(new Set(shots.map((s) => s.thumb_url)).size).toBe(3);
    expect(shots.every((s) => s.blurred)).toBe(true);
  });

  it('should_store_a_resent_batch_once', async () => {
    const again = await device.post('/agent/ingest/batch', batch);
    expect(again.body.results.map((r: { status: string }) => r.status)).toEqual(['duplicate', 'duplicate', 'duplicate']);
    expect(shotsOf((await admin.get(o(`/activity/day?membership_id=${workerId}&date=${day}`))).body)).toHaveLength(3);
  });

  it('should_show_the_worker_their_own_three_screens_but_never_send_them_to_a_device', async () => {
    expect(shotsOf((await worker.get(o(`/activity/day?date=${day}`))).body).map((s) => s.display_index).sort()).toEqual([0, 1, 2]);
    const own = await device.get(`/agent/me/activity?date=${day}`);
    expect(own.status).toBe(200);
    expect(shotsOf(own.body)).toEqual([]);
    for (const id of shotIds) expect(JSON.stringify(own.body)).not.toContain(id);
  });
});
