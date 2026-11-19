import { beforeEach, describe, expect, it, vi } from 'vitest';

// Manual time is saved on this computer first and sent later, so the form must not say "sent" until the
// server has answered (QA round 6, BUG-23). The agent returns the request's id and keeps its status:
// queued until delivered, then sent, or rejected with the server's reason, which the form shows.
const disk = new Map<string, unknown>();
const pushed: Array<{ event_id: string; type: string }> = [];

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
    async request() {
      throw new TypeError('net::ERR_INTERNET_DISCONNECTED');
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
    push(e: { event_id: string; type: string }) {
      pushed.push(e);
    }
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

function newAgent() {
  const agent = new Agent('http://127.0.0.1:3100', '0.3.0');
  const a = agent as unknown as Record<string, unknown>;
  a.startMonitors = vi.fn();
  a.stopMonitors = vi.fn();
  a.flushObservations = vi.fn();
  a.emitState = vi.fn();
  a.sync = vi.fn(async () => undefined);
  a.boot = {
    organization: { id: 'org', name: 'Org', timezone: 'UTC' },
    worker: { membership_id: 'm', name: 'Worker', email: 'w@example.test', timezone: 'UTC' },
    device: { id: 'd', status: 'ACTIVE' },
    policy: { ...DEFAULT_POLICY, manualTime: { ...DEFAULT_POLICY.manualTime, allowed: true, reasonRequired: false } },
    policy_hash: 'hash',
    assignments: [{ project_id: 'p1', project_name: 'Site', tasks: [] }],
    current_session: null,
    today_seconds: 0,
    week_seconds: 0,
    timesheet_due: null,
    next_shift: null,
    break_types: [],
  };
  return agent;
}

const request = { projectId: 'p1', taskId: null, startedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), endedAt: new Date(Date.now() - 3600_000).toISOString(), reason: '' };

beforeEach(() => {
  disk.clear();
  pushed.length = 0;
});

describe('a manual time request from this computer', () => {
  it('returns its id and stays queued until the server answers', async () => {
    const agent = newAgent();
    const id = await agent.requestManualTime(request);
    expect(id).toBe(pushed[0]!.event_id);
    expect(agent.state().manualRequests[0]).toMatchObject({ id, status: 'queued', message: null });
  });

  it('is marked sent once the server accepts it', async () => {
    const agent = newAgent();
    const id = await agent.requestManualTime(request);
    (agent as unknown as { settleManualRequests: (r: unknown[]) => void }).settleManualRequests([{ event_id: id, status: 'accepted' }]);
    expect(agent.state().manualRequests[0]).toMatchObject({ id, status: 'sent' });
  });

  it('keeps the server’s reason when it is refused', async () => {
    const agent = newAgent();
    const id = await agent.requestManualTime(request);
    const reason = 'The timesheet for this period is approved; ask your manager to reopen it, then try again';
    (agent as unknown as { settleManualRequests: (r: unknown[]) => void }).settleManualRequests([{ event_id: id, status: 'rejected', message: reason }]);
    expect(agent.state().manualRequests[0]).toMatchObject({ id, status: 'rejected', message: reason });
  });
});
