import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Offline as a controlled, temporary mode (UX remediation, phase 2): a restart without a connection
// tracks from the saved account and settings; past max offline hours it refuses new sessions; signing
// out removes the saved copy; and records the server refuses are kept and explained, never dropped.
const disk = new Map<string, unknown>();
let reachable = true;
let signedIn = true;
let ingest: (events: Array<{ event_id: string; type: string }>) => Array<{ event_id: string; status: string; code?: string; message?: string }> = (events) => events.map((e) => ({ event_id: e.event_id, status: 'accepted' }));
const sent: Array<{ event_id: string; type: string }> = [];
const dismissed: string[] = [];

vi.mock('electron', () => ({ Notification: class { show() {} }, net: {}, powerMonitor: { on: () => undefined }, desktopCapturer: {}, nativeImage: {}, screen: {}, systemPreferences: {} }));
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
      return signedIn;
    }
    clear() {
      signedIn = false;
    }
    async request(_method: string, path: string, body?: { events: Array<{ event_id: string; type: string }> }) {
      if (!reachable) throw new TypeError('net::ERR_INTERNET_DISCONNECTED');
      if (path === '/agent/bootstrap') return bootstrap();
      if (path === '/agent/heartbeat') return { session: null };
      if (path.startsWith('/agent/me/refused/')) return void dismissed.push(path);
      if (path === '/agent/ingest/batch') {
        sent.push(...body!.events);
        return { results: ingest(body!.events), session: null, policy_hash: 'hash' };
      }
      throw new Error(`unexpected ${path}`);
    }
  },
}));
vi.mock('../src/main/services/queue', () => {
  const files = new Map<string, Array<{ event_id: string; type: string }>>();
  return {
    queueFileFor: (account: string | null) => (account ? `queue-${account}` : 'queue'),
    OfflineQueue: class {
      static adoptLegacy() {}
      full = false;
      constructor(
        _store: unknown,
        readonly file = 'queue',
      ) {
        if (!files.has(file)) files.set(file, []);
      }
      get events() {
        return files.get(this.file)!;
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
      some(f: (e: { type: string; session_id?: string }) => boolean) {
        return this.events.some(f);
      }
      ack(ids: string[]) {
        files.set(this.file, this.events.filter((e) => !ids.includes(e.event_id)));
      }
    },
  };
});

const { Agent } = await import('../src/main/services/agent');
const { DEFAULT_POLICY } = await import('@tallywork/domain');

const PROJECT = '0190a000-0000-7000-8000-000000000001';
function bootstrap() {
  return {
    organization: { id: 'org', name: 'Org', timezone: 'UTC' },
    worker: { membership_id: 'm', name: 'Worker', email: 'w@example.test', timezone: 'UTC' },
    device: { id: 'd', status: 'ACTIVE' },
    policy: { ...DEFAULT_POLICY, tracking: { ...DEFAULT_POLICY.tracking, maxOfflineHours: 8 } },
    policy_hash: 'hash',
    assignments: [{ project_id: PROJECT, project_name: 'Alpha', color: '#000', client_name: null, tasks: [], breaks: [] }],
    current_session: null,
    today_seconds: 3600,
    week_seconds: 7200,
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

beforeEach(() => {
  disk.clear();
  sent.length = 0;
  dismissed.length = 0;
  reachable = true;
  signedIn = true;
  ingest = (events) => events.map((e) => ({ event_id: e.event_id, status: 'accepted' }));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T09:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('starting offline from the saved account', () => {
  it('a restart without a connection tracks from the saved settings, and says so', async () => {
    await newAgent().refreshBootstrap(); // online once: account and settings saved

    reachable = false;
    vi.setSystemTime(new Date('2026-11-04T11:00:00Z'));
    const offline = newAgent();
    await offline.refreshBootstrap();
    const s = offline.state();
    expect(s.account?.organization).toBe('Org');
    expect(s.offline).toMatchObject({ mode: 'offline', settingsSavedAt: '2026-11-04T09:00:00.000Z', allowedUntil: '2026-11-04T17:00:00.000Z', totalsPartial: true });
    // Same day: the saved totals still apply.
    expect(s.todaySeconds).toBe(3600);

    await offline.start(PROJECT, null);
    expect(offline.state().tracking.state).toBe('active');
  });

  it('refuses new sessions once max offline hours have passed since the last contact', async () => {
    await newAgent().refreshBootstrap();
    reachable = false;
    vi.setSystemTime(new Date('2026-11-04T17:30:00Z'));
    const agent = newAgent();
    expect(agent.state().offline.mode).toBe('expired');
    await expect(agent.start(PROJECT, null)).rejects.toThrow(/offline for more than 8 hours/);
    expect(() => agent.assertMayTrack()).toThrow(/Connect to the internet/);

    // Back online: allowed again, and the server's settings replace the saved ones.
    reachable = true;
    await agent.refreshBootstrap();
    expect(agent.state().offline).toMatchObject({ mode: 'online', settingsSavedAt: null, totalsPartial: false });
    await agent.start(PROJECT, null);
  });

  it('pauses a running session when offline tracking runs out, at that moment, and never resumes on its own', async () => {
    const agent = newAgent();
    await agent.refreshBootstrap(); // last contact 09:00, 8 hours allowed
    (agent as unknown as { sync: () => Promise<void> }).sync = vi.fn(async () => undefined);
    await agent.start(PROJECT, null);
    reachable = false;
    await agent.refreshBootstrap(); // the connection is gone
    vi.setSystemTime(new Date('2026-11-04T17:10:00Z'));
    agent.checkOfflineExpiry();

    const s = agent.state();
    expect(s.tracking.state).toBe('paused');
    expect(s.offline.pausedAt).toBe('2026-11-04T17:00:00.000Z');
    // Counted up to the expiry, not to now: 8 hours.
    expect(s.tracking.baseSeconds).toBe(8 * 3600);
    const events = (agent as unknown as { queue: { events: Array<{ type: string; occurred_at: string }> } }).queue.events;
    expect(events.find((e) => e.type === 'session.pause')?.occurred_at).toBe('2026-11-04T17:00:00.000Z');
    // The earlier records are still queued, not dropped.
    expect(events[0]!.type).toBe('session.start');
    expect(() => agent.assertMayTrack()).toThrow(/Connect to the internet/);

    // Back online: still paused until the worker clocks back in.
    reachable = true;
    await agent.refreshBootstrap();
    expect(agent.state().tracking.state).toBe('paused');
    expect(agent.state().offline.pausedAt).toBe('2026-11-04T17:00:00.000Z');
    agent.assertMayTrack();
    agent.resume();
    expect(agent.state().tracking.state).toBe('active');
    expect(agent.state().offline.pausedAt).toBeNull();
  });

  it('on another day, the saved totals are not shown as today’s', async () => {
    await newAgent().refreshBootstrap();
    reachable = false;
    vi.setSystemTime(new Date('2026-11-05T01:00:00Z'));
    const s = newAgent().state();
    expect([s.todaySeconds, s.weekSeconds, s.offline.totalsPartial]).toEqual([0, 0, true]);
  });

  it('signing out removes the saved account and settings', async () => {
    const agent = newAgent();
    await agent.refreshBootstrap();
    await agent.logout();
    expect(disk.get('bootstrap-cache')).toBeNull();
    signedIn = true; // a stale sign-in can never bring the old account back offline
    reachable = false;
    expect(newAgent().state().account).toBeNull();
  });
});

describe('records the server refuses', () => {
  it('are kept with a plain reason, survive a restart, and go only when the worker removes them', async () => {
    const agent = newAgent();
    await agent.refreshBootstrap();
    // The worker was taken off the project meanwhile: the start is refused, the rest follows.
    ingest = (events) => events.map((e) => ({ event_id: e.event_id, status: 'rejected', code: e.type === 'session.start' ? 'forbidden' : 'session_not_found', message: 'x' }));
    await agent.start(PROJECT, null);
    await agent.stop();
    await vi.waitFor(async () => {
      await agent.sync();
      expect(agent.state().sync.queued).toBe(0);
    });
    const [item] = agent.state().notAdded;
    expect(item).toMatchObject({ kind: 'time', projectId: PROJECT, reason: 'You are no longer on this project.' });

    const restarted = newAgent();
    expect(restarted.state().notAdded.map((i) => i.id)).toEqual([item!.id]);
    restarted.dismissNotAdded(item!.id);
    expect(restarted.state().notAdded).toEqual([]);
    expect(newAgent().state().notAdded).toEqual([]);
  });

  it('a sync interrupted before its answer sends the same records again (the server answers duplicate)', async () => {
    const agent = newAgent();
    await agent.refreshBootstrap();
    // Every batch reaches the server but its answer is lost.
    ingest = () => {
      throw new TypeError('net::ERR_CONNECTION_RESET');
    };
    await agent.start(PROJECT, null);
    await agent.stop();
    await vi.waitFor(() => expect(agent.state().sync.online).toBe(false));
    await agent.sync();
    const queued = agent.state().sync.queued;
    expect(queued).toBeGreaterThanOrEqual(2);
    expect(agent.state().sync.online).toBe(false);

    ingest = (events) => events.map((e) => ({ event_id: e.event_id, status: 'duplicate' }));
    await agent.sync();
    expect(agent.state().sync.queued).toBe(0);
    // Sent more than once, always with the same event ids: the server can recognize them.
    const ids = sent.map((e) => e.event_id);
    expect(ids.length).toBeGreaterThan(queued);
    expect(new Set(ids).size).toBe(queued);
    expect(agent.state().notAdded).toEqual([]);
  });
});

describe('refused time and the server', () => {
  async function refusedSession() {
    const agent = newAgent();
    await agent.refreshBootstrap();
    ingest = (events) => events.map((e) => ({ event_id: e.event_id, status: 'rejected', code: e.type === 'session.start' ? 'forbidden' : 'session_not_found', message: 'x' }));
    await agent.start(PROJECT, null);
    await agent.stop();
    await vi.waitFor(async () => {
      await agent.sync();
      expect(agent.state().notAdded).toHaveLength(1);
    });
    ingest = (events) => events.map((e) => ({ event_id: e.event_id, status: 'accepted' }));
    return { agent, id: agent.state().notAdded[0]!.id };
  }

  it('asking for it as manual time links the request to the refused session, and clears the note here', async () => {
    const { agent, id } = await refusedSession();
    sent.length = 0;
    await agent.requestManualTime({ projectId: PROJECT, taskId: null, startedAt: '2026-11-04T08:00:00.000Z', endedAt: '2026-11-04T08:30:00.000Z', reason: 'Offline work', refusedSessionId: id });
    expect(agent.state().notAdded).toEqual([]);
    await vi.waitFor(() => expect(sent.find((e) => e.type === 'manual_time.request')).toMatchObject({ refused_session_id: id }));
    expect(dismissed).toEqual([]); // not "removed": it was asked for
  });

  it('removing it tells the server, also when that has to wait for the connection', async () => {
    const { agent, id } = await refusedSession();
    reachable = false;
    agent.dismissNotAdded(id);
    expect(agent.state().notAdded).toEqual([]);
    await vi.waitFor(() => expect(dismissed).toEqual([]));
    reachable = true;
    await agent.start(PROJECT, null); // something to sync
    await vi.waitFor(async () => {
      await agent.sync();
      expect(dismissed).toEqual([`/agent/me/refused/${id}/dismiss`]);
    });
  });
});
