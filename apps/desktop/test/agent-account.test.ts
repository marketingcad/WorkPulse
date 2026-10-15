import { beforeEach, describe, expect, it, vi } from 'vitest';

// Two people using one computer (audit DT-1): queued events must only ever be sent with the
// credentials of the person who recorded them. The agent core runs with its OS-facing pieces
// replaced; the store and the per-account queue files live in memory, as on disk.
const disk = new Map<string, unknown>();
const files = new Map<string, Array<{ event_id: string; type: string; session_id?: string }>>();
const sent: Array<{ account: string; events: Array<{ type: string; session_id?: string }> }> = [];
let signedInAs: { org: string; member: string } | null = null;

vi.mock('electron', () => ({ Notification: class {}, net: {}, powerMonitor: { on: () => undefined }, desktopCapturer: {}, nativeImage: {}, screen: {} }));
vi.mock('../src/main/services/secure-store', () => ({
  SecureStore: class {
    readJson = (name: string) => (disk.has(name) ? structuredClone(disk.get(name)) : null);
    writeJson = (name: string, value: unknown) => void disk.set(name, structuredClone(value));
  },
}));
vi.mock('../src/main/services/api', () => ({
  ApiError: class extends Error {},
  AgentApi: class {
    serverUrl = null;
    onSignedOut = () => undefined;
    get signedIn() {
      return !!signedInAs;
    }
    clear() {
      signedInAs = null;
    }
    async request(method: string, path: string, body?: { events: Array<{ event_id: string; type: string }> }) {
      if (!signedInAs) throw new Error('not signed in');
      if (path === '/agent/bootstrap') return bootstrap(signedInAs.org, signedInAs.member);
      if (path === '/agent/ingest/batch') {
        sent.push({ account: `${signedInAs.org}:${signedInAs.member}`, events: body!.events });
        return { results: body!.events.map((e) => ({ event_id: e.event_id, status: 'accepted' })), session: null, policy_hash: 'hash' };
      }
      throw new Error(`unexpected ${method} ${path}`);
    }
  },
}));
vi.mock('../src/main/services/queue', () => ({
  queueFileFor: (account: string | null) => (account ? `queue-${account}.log` : 'queue.log'),
  OfflineQueue: class {
    static adoptLegacy(_store: unknown, fileName: string) {
      if (files.has('queue.log') && !files.has(fileName)) {
        files.set(fileName, files.get('queue.log')!);
        files.delete('queue.log');
      }
    }
    full = false;
    constructor(
      _store: unknown,
      readonly fileName = 'queue.log',
    ) {
      if (!files.has(fileName)) files.set(fileName, []);
    }
    get events() {
      return files.get(this.fileName)!;
    }
    push(e: { event_id: string; type: string }) {
      this.events.push(e);
    }
    get size() {
      return this.events.length;
    }
    peek(n: number) {
      return this.events.slice(0, n);
    }
    ack(ids: string[]) {
      files.set(
        this.fileName,
        this.events.filter((e) => !ids.includes(e.event_id)),
      );
    }
  },
}));

const { Agent } = await import('../src/main/services/agent');
const { DEFAULT_POLICY } = await import('@tallywork/domain');

const PROJECT = '0190a000-0000-7000-8000-000000000001';

function bootstrap(org: string, member: string) {
  return {
    organization: { id: org, name: 'Org', timezone: 'UTC' },
    worker: { membership_id: member, name: member, email: `${member}@example.test`, timezone: 'UTC' },
    device: { id: `device-${member}`, status: 'ACTIVE' },
    policy: DEFAULT_POLICY,
    policy_hash: 'hash',
    assignments: [{ project_id: PROJECT, project_name: 'Alpha', color: '#000', client_name: null, tasks: [] }],
    current_session: null,
    today_seconds: 0,
    week_seconds: 0,
    timesheet_due: null,
    next_shift: null,
    break_types: [],
  };
}

function newAgent() {
  const agent = new Agent('http://127.0.0.1:3100', '0.0.0-test');
  const a = agent as unknown as Record<string, unknown>;
  a.startMonitors = vi.fn();
  a.stopMonitors = vi.fn();
  a.flushObservations = vi.fn();
  a.emitState = vi.fn();
  return agent;
}

const types = (account: string) => (files.get(`queue-${account}.log`) ?? []).map((e) => e.type);

beforeEach(() => {
  disk.clear();
  files.clear();
  sent.length = 0;
  signedInAs = null;
});

describe('one computer, two accounts', () => {
  it('time recorded offline by one person is never sent as the next person who signs in', async () => {
    // Ann tracks time while offline, then signs out: nothing could be sent.
    signedInAs = { org: 'org', member: 'ann' };
    const agent = newAgent();
    await agent.refreshBootstrap();
    (agent as unknown as { sync: () => Promise<void> }).sync = vi.fn(async () => undefined);
    await agent.start(PROJECT, null);
    await agent.stop();
    await agent.requestManualTime({ projectId: PROJECT, taskId: null, startedAt: '2026-10-01T09:00:00.000Z', endedAt: '2026-10-01T10:00:00.000Z', reason: 'call' }).catch(() => undefined);
    const annQueued = types('org:ann');
    expect(annQueued).toContain('session.start');
    await agent.logout();

    // Ben signs in on the same computer and works online.
    delete (agent as unknown as { sync?: unknown }).sync;
    signedInAs = { org: 'org', member: 'ben' };
    await agent.refreshBootstrap();
    await agent.start(PROJECT, null);
    await agent.sync();

    // Only Ben's events went out with Ben's credentials; Ann's stay queued for Ann.
    expect(sent.every((b) => b.account === 'org:ben')).toBe(true);
    expect(sent.flatMap((b) => b.events.map((e) => e.type))).toEqual(['session.start']);
    expect(types('org:ann')).toEqual(annQueued);
    expect(agent.state().manualRequests).toEqual([]);

    // When Ann signs in again, her own events are delivered with her credentials.
    await agent.stop();
    await agent.sync();
    signedInAs = { org: 'org', member: 'ann' };
    await agent.refreshBootstrap();
    await agent.sync();
    expect(sent.filter((b) => b.account === 'org:ann').flatMap((b) => b.events.map((e) => e.type))).toEqual(annQueued);
    expect(types('org:ann')).toEqual([]);
  });

  it('a timer left running when the session expired is stopped into its owner’s queue, not continued for the next person', async () => {
    signedInAs = { org: 'org', member: 'ann' };
    const agent = newAgent();
    await agent.refreshBootstrap();
    (agent as unknown as { sync: () => Promise<void> }).sync = vi.fn(async () => undefined);
    await agent.start(PROJECT, null);
    // Ann's session expires (forced sign-out keeps the local timer); Ben signs in.
    signedInAs = { org: 'org', member: 'ben' };
    await agent.refreshBootstrap();

    expect(types('org:ann')).toEqual(['session.start', 'session.stop']);
    expect(types('org:ben')).toEqual([]);
    expect(agent.state().tracking.sessionId).toBeNull();
    expect(disk.get('last-project')).toBeNull();
  });

  it('the same person signing in again keeps their queue', async () => {
    signedInAs = { org: 'org', member: 'ann' };
    const agent = newAgent();
    await agent.refreshBootstrap();
    (agent as unknown as { sync: () => Promise<void> }).sync = vi.fn(async () => undefined);
    await agent.start(PROJECT, null);
    await agent.refreshBootstrap();
    expect(types('org:ann')).toEqual(['session.start']);
    expect(agent.state().tracking.sessionId).not.toBeNull();
  });

  it('after an upgrade, events in the old shared queue go to the first account that signs in', async () => {
    files.set('queue.log', [{ event_id: 'e1', type: 'session.stop', session_id: 's1' }]);
    signedInAs = { org: 'org', member: 'ann' };
    const agent = newAgent();
    await agent.refreshBootstrap();
    await agent.sync();
    expect(sent).toEqual([{ account: 'org:ann', events: [{ event_id: 'e1', type: 'session.stop', session_id: 's1' }] }]);
  });
});
