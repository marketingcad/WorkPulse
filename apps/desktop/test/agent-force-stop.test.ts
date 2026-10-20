import { beforeEach, describe, expect, it, vi } from 'vitest';

// The agent core with its OS-facing pieces replaced: no Electron, no disk, no network, no monitors.
const notifications: string[] = [];
vi.mock('electron', () => ({
  Notification: class {
    constructor(private readonly o: { title: string }) {}
    show() {
      notifications.push(this.o.title);
    }
  },
  net: {},
  powerMonitor: { on: () => undefined },
  desktopCapturer: {},
  nativeImage: {},
  screen: {},
}));
vi.mock('../src/main/services/secure-store', () => ({
  SecureStore: class {
    readJson = () => null;
    writeJson = () => undefined;
  },
}));
vi.mock('../src/main/services/api', () => ({
  ApiError: class extends Error {},
  AgentApi: class {
    signedIn = true;
    serverUrl = null;
    onSignedOut = () => undefined;
    request = vi.fn();
  },
}));
vi.mock('../src/main/services/queue', () => ({
  queueFileFor: (account: string | null) => account ?? 'queue.log',
  OfflineQueue: class {
    full = false;
    events: Array<{ event_id: string; type: string; session_id?: string }> = [];
    push(e: { event_id: string; type: string; session_id?: string }) {
      this.events.push(e);
    }
    get size() {
      return this.events.length;
    }
    some(match: (e: { type: string; session_id?: string }) => boolean) {
      return this.events.some(match);
    }
    peek(limit: number) {
      return this.events.slice(0, limit);
    }
    ack(ids: string[]) {
      this.events = this.events.filter((e) => !ids.includes(e.event_id));
    }
  },
}));

const { Agent } = await import('../src/main/services/agent');
const { DEFAULT_POLICY } = await import('@tallywork/domain');

const PROJECT = '0190a000-0000-7000-8000-000000000001';
const ACCOUNT = 'org:m';

type Internals = {
  session: { id: string; state: string } | null;
  queue: { events: Array<{ event_id: string; type: string; session_id?: string }> };
  api: { request: ReturnType<typeof vi.fn> };
  stopMonitors: ReturnType<typeof vi.fn>;
  heartbeat: () => Promise<void>;
  enqueue: (e: Record<string, unknown>) => void;
};

/** A signed-in agent with a session whose start the server already has. */
async function trackingAgent() {
  const agent = new Agent('http://127.0.0.1:3100', '0.0.0-test');
  const a = agent as unknown as Record<string, unknown> & Internals;
  a.boot = {
    organization: { id: 'org', name: 'Org', timezone: 'UTC' },
    worker: { membership_id: 'm', name: 'Worker', email: 'w@example.test', timezone: 'UTC' },
    device: { id: 'd', status: 'ACTIVE' },
    policy: DEFAULT_POLICY,
    policy_hash: 'hash',
    assignments: [{ project_id: PROJECT, project_name: 'Alpha', color: '#000', client_name: null, tasks: [], breaks: [] }],
    current_session: null,
    today_seconds: 0,
    week_seconds: 0,
    timesheet_due: null,
    next_shift: null,
    break_types: [],
  };
  a.account = ACCOUNT;
  a.useAccount = vi.fn();
  a.startMonitors = vi.fn();
  a.stopMonitors = vi.fn();
  a.emitState = vi.fn();
  const sync = agent.sync.bind(agent);
  a.sync = vi.fn(async () => undefined);
  await agent.start(PROJECT, null);
  a.queue.events = []; // the start was delivered
  a.sync = sync;
  return a;
}

const live = (id: string) => ({ id, state: 'ACTIVE', project_id: PROJECT, task_id: null, started_at: new Date().toISOString(), end_reason: null });

beforeEach(() => {
  notifications.length = 0;
});

describe('admin force stop reaches the desktop', () => {
  it('stops when the heartbeat reports no session, even while activity minutes are queued (regression)', async () => {
    const a = await trackingAgent();
    const id = a.session!.id;
    // The 60 s flush runs in the same tick as the 60 s heartbeat: minutes are queued while the request is in flight.
    a.api.request.mockImplementation(async () => {
      a.enqueue({ type: 'activity.minutes', session_id: id, occurred_at: new Date().toISOString(), minutes: [] });
      return { server_time: new Date().toISOString(), session: null, policy_hash: 'hash' };
    });
    await a.heartbeat();
    expect(a.queue.events).toHaveLength(1);
    expect(a.session).toBeNull();
    expect(a.stopMonitors).toHaveBeenCalled();
    expect(notifications).toEqual(['Tracking stopped']);
  });

  it('stops when a sync delivers events and the server no longer has the session', async () => {
    const a = await trackingAgent();
    const id = a.session!.id;
    a.enqueue({ type: 'activity.minutes', session_id: id, occurred_at: new Date().toISOString(), minutes: [] });
    a.api.request.mockImplementation(async (_m: string, _p: string, body: { events: Array<{ event_id: string }> }) => ({
      results: body.events.map((e) => ({ event_id: e.event_id, status: 'accepted' })),
      session: null,
      policy_hash: 'hash',
    }));
    await (a as unknown as { sync: () => Promise<void> }).sync();
    expect(a.queue.events).toEqual([]);
    expect(a.session).toBeNull();
    expect(notifications).toEqual(['Tracking stopped']);
  });

  it('keeps tracking while the server still has this session', async () => {
    const a = await trackingAgent();
    const id = a.session!.id;
    a.api.request.mockResolvedValue({ server_time: new Date().toISOString(), session: live(id), policy_hash: 'hash' });
    await a.heartbeat();
    expect(a.session?.id).toBe(id);
    expect(a.stopMonitors).not.toHaveBeenCalled();
    expect(notifications).toEqual([]);
  });

  it('keeps tracking while its start is still unsent (offline start), since the server cannot know it yet', async () => {
    const a = await trackingAgent();
    const id = a.session!.id;
    a.enqueue({ type: 'session.start', session_id: id, seq: 1, occurred_at: new Date().toISOString(), project_id: PROJECT, task_id: null });
    a.api.request.mockResolvedValue({ server_time: new Date().toISOString(), session: null, policy_hash: 'hash' });
    await a.heartbeat();
    expect(a.session?.id).toBe(id);
    expect(notifications).toEqual([]);
  });

  it('stops when the server reports another session (started elsewhere)', async () => {
    const a = await trackingAgent();
    a.api.request.mockResolvedValue({ server_time: new Date().toISOString(), session: live('0190a000-0000-7000-8000-0000000000ff'), policy_hash: 'hash' });
    await a.heartbeat();
    expect(a.session).toBeNull();
  });
});
