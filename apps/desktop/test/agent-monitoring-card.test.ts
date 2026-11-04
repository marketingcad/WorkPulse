import { beforeEach, describe, expect, it, vi } from 'vitest';

// The "What WorkPulse records" card is an organization setting (hidden unless an admin shows it):
// the app reads it when it starts, applies a change from the next heartbeat, and keeps it in the
// saved copy so a restart without a connection shows the same.
const disk = new Map<string, unknown>();
let reachable = true;
let bootShows: boolean | undefined = false;
let beatShows: boolean | undefined = false;

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
      return true;
    }
    clear() {}
    async request(_method: string, path: string) {
      if (!reachable) throw new TypeError('net::ERR_INTERNET_DISCONNECTED');
      if (path === '/agent/bootstrap') return bootstrap();
      if (path === '/agent/heartbeat') return { session: null, ...(beatShows === undefined ? {} : { show_monitoring_card: beatShows }) };
      throw new Error(`unexpected ${path}`);
    }
  },
}));
vi.mock('../src/main/services/queue', () => ({
  queueFileFor: (account: string | null) => (account ? `queue-${account}` : 'queue'),
  OfflineQueue: class {
    static adoptLegacy() {}
    full = false;
    events: unknown[] = [];
    size = 0;
    push() {}
    peek() {
      return [];
    }
    some() {
      return false;
    }
    ack() {}
  },
}));

const { Agent } = await import('../src/main/services/agent');
const { DEFAULT_POLICY } = await import('@tallywork/domain');

function bootstrap() {
  return {
    organization: { id: 'org', name: 'Org', timezone: 'UTC', ...(bootShows === undefined ? {} : { show_monitoring_card: bootShows }) },
    worker: { membership_id: 'm', name: 'Worker', email: 'w@example.test', timezone: 'UTC' },
    device: { id: 'd', status: 'ACTIVE' },
    policy: DEFAULT_POLICY,
    policy_hash: 'hash',
    assignments: [],
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
const heartbeat = (agent: InstanceType<typeof Agent>) => (agent as unknown as { heartbeat(): Promise<void> }).heartbeat();

beforeEach(() => {
  disk.clear();
  reachable = true;
  bootShows = false;
  beatShows = false;
});

describe('the "What WorkPulse records" card', () => {
  it('is hidden by default, also when the server does not say (an older server)', async () => {
    const agent = newAgent();
    await agent.refreshBootstrap();
    expect(agent.state().showMonitoringCard).toBe(false);
    bootShows = undefined;
    await agent.refreshBootstrap();
    expect(agent.state().showMonitoringCard).toBe(false);
  });

  it('follows the admin setting from the next heartbeat, without waiting for a restart', async () => {
    const agent = newAgent();
    await agent.refreshBootstrap();
    beatShows = true;
    await heartbeat(agent);
    expect(agent.state().showMonitoringCard).toBe(true);
    beatShows = false;
    await heartbeat(agent);
    expect(agent.state().showMonitoringCard).toBe(false);
    // A heartbeat that does not mention it (an older server) changes nothing.
    beatShows = undefined;
    bootShows = true;
    await agent.refreshBootstrap();
    await heartbeat(agent);
    expect(agent.state().showMonitoringCard).toBe(true);
  });

  it('a restart without a connection shows what was last applied', async () => {
    const online = newAgent();
    await online.refreshBootstrap();
    beatShows = true;
    await heartbeat(online);

    reachable = false;
    const offline = newAgent();
    await offline.refreshBootstrap();
    expect(offline.state().offline.mode).toBe('offline');
    expect(offline.state().showMonitoringCard).toBe(true);
  });
});
