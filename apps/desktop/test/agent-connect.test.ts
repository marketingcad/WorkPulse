import { describe, expect, it, vi } from 'vitest';

// Starting the app without a connection (UX audit C1): the window must learn why the account
// could not load, in plain words, and that clears once it loads.
let reachable = false;

vi.mock('electron', () => ({ Notification: class {}, net: {}, powerMonitor: { on: () => undefined }, desktopCapturer: {}, nativeImage: {}, screen: {} }));
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
    async request(_method: string, path: string) {
      if (!reachable) throw new TypeError('net::ERR_INTERNET_DISCONNECTED');
      if (path === '/agent/bootstrap') return bootstrap();
      throw new Error(`unexpected ${path}`);
    }
  },
}));
vi.mock('../src/main/services/queue', () => ({
  queueFileFor: () => 'queue.log',
  OfflineQueue: class {
    static adoptLegacy() {}
    full = false;
    size = 0;
  },
}));

const { Agent } = await import('../src/main/services/agent');
const { DEFAULT_POLICY } = await import('@tallywork/domain');
const { OFFLINE_MESSAGE } = await import('../src/shared/errors');

function bootstrap() {
  return {
    organization: { id: 'org', name: 'Org', timezone: 'UTC' },
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

describe('starting without a connection', () => {
  it('reports why the account did not load, then clears it once connected', async () => {
    const agent = new Agent('http://127.0.0.1:3100', '0.0.0-test');
    (agent as unknown as { emitState: () => void }).emitState = vi.fn();

    reachable = false;
    await agent.refreshBootstrap();
    let s = agent.state();
    expect(s.account).toBeNull();
    expect(s.sync.online).toBe(false);
    expect(s.connectError).toBe(OFFLINE_MESSAGE);
    // Clock in is refused with a sentence, not "Not ready".
    await expect(agent.start('0190a000-0000-7000-8000-000000000001', null)).rejects.toThrow(/hasn’t finished connecting/);

    reachable = true;
    await agent.refreshBootstrap();
    s = agent.state();
    expect(s.account?.organization).toBe('Org');
    expect(s.sync.online).toBe(true);
    expect(s.connectError).toBeNull();
  });
});
