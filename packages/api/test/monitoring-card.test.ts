import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/**
 * The "What WorkPulse records" card in the desktop app: a system admin shows or hides it for the
 * whole organization (hidden unless turned on). The app reads it when it starts and with every
 * heartbeat, so a change applies within a minute without a "settings changed" notice.
 */
let t: Harness;
let admin: Client;
let orgId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function deviceFor(member: Client) {
  const { verifier, challenge } = pkce();
  const code = await member.post<{ code: string }>('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const agent = new Client(t);
  const reg = await agent.post<{ access_token: string }>('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'Laptop', platform: 'windows', agent_version: '0.1.9' } });
  agent.bearer = reg.body.access_token;
  return agent;
}
const shown = async (device: Client) => {
  const boot = await device.get<{ organization: { show_monitoring_card: boolean }; policy_hash: string }>('/agent/bootstrap');
  const beat = await device.post<{ show_monitoring_card: boolean; policy_hash: string }>('/agent/heartbeat', { sent_at: t.clock.now.toISOString(), session_id: null });
  expect(beat.body.show_monitoring_card).toBe(boot.body.organization.show_monitoring_card);
  return { shown: boot.body.organization.show_monitoring_card, hash: boot.body.policy_hash };
};

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada Admin', 'ada@card.test'));
}, 60_000);
afterAll(() => t.close());

describe('the monitoring card setting', () => {
  it('is hidden by default; an admin turns it on and off, and the desktop app follows', async () => {
    const { client: walt } = await addMember(t, admin, orgId, 'Walt Worker', 'walt@card.test');
    const device = await deviceFor(walt);
    const before = await shown(device);
    expect(before.shown).toBe(false);

    expect((await admin.patch(o(''), { settings: { showMonitoringCard: true } })).status).toBe(200);
    const on = await shown(device);
    expect(on.shown).toBe(true);
    // Not a tracking-policy change: the worker is not asked to review "changed settings".
    expect(on.hash).toBe(before.hash);

    expect((await admin.patch(o(''), { settings: { showMonitoringCard: false } })).status).toBe(200);
    expect((await shown(device)).shown).toBe(false);
  });

  it('is changed only by someone who manages the organization, and the change is audited', async () => {
    const { client: wren } = await addMember(t, admin, orgId, 'Wren Worker', 'wren@card.test');
    const { client: mo } = await addMember(t, admin, orgId, 'Mo Manager', 'mo@card.test', 'TEAM_MANAGER');
    expect((await wren.patch(o(''), { settings: { showMonitoringCard: true } })).status).toBe(403);
    expect((await mo.patch(o(''), { settings: { showMonitoringCard: true } })).status).toBe(403);
    expect((await admin.get<{ organization: { settings: { showMonitoringCard?: boolean } } }>(o(''))).body.organization.settings.showMonitoringCard ?? false).toBe(false);
    expect((await admin.patch(o(''), { settings: { showMonitoringCard: 'yes' } })).status).toBe(400);

    expect((await admin.patch(o(''), { settings: { showMonitoringCard: true } })).status).toBe(200);
    const logs = (await admin.get<{ data: Array<{ action: string; after: unknown }> } | Array<{ action: string; after: unknown }>>(o('/audit-logs'))).body;
    const entry = (Array.isArray(logs) ? logs : logs.data).find((l) => l.action === 'organization.updated' && JSON.stringify(l.after).includes('showMonitoringCard'));
    expect(entry).toBeDefined();
  });

  it('is per organization', async () => {
    expect((await admin.patch(o(''), { settings: { showMonitoringCard: true } })).status).toBe(200);
    const other = await signup(t, 'Olga Other', 'olga@card-other.test');
    expect((await other.client.get<{ organization: { settings: { showMonitoringCard?: boolean } } }>(`/orgs/${other.orgId}`)).body.organization.settings.showMonitoringCard ?? false).toBe(false);
  });
});
