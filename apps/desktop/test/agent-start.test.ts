import { describe, expect, it, vi } from 'vitest';

// The agent core with its OS-facing pieces replaced: no Electron, no disk, no network, no monitors.
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
  },
}));
vi.mock('../src/main/services/queue', () => ({
  queueFileFor: (account: string | null) => account ?? 'queue.log',
  OfflineQueue: class {
    full = false;
    events: unknown[] = [];
    push(e: unknown) {
      this.events.push(e);
    }
    get size() {
      return this.events.length;
    }
  },
}));

const { Agent } = await import('../src/main/services/agent');
const { DEFAULT_POLICY } = await import('@tallywork/domain');

const PROJECT = '0190a000-0000-7000-8000-000000000001';

function readyAgent(policy = DEFAULT_POLICY) {
  const agent = new Agent('http://127.0.0.1:3100', '0.0.0-test');
  const a = agent as unknown as Record<string, unknown>;
  a.boot = {
    organization: { id: 'org', name: 'Org', timezone: 'UTC' },
    worker: { membership_id: 'm', name: 'Worker', email: 'w@example.test', timezone: 'UTC' },
    device: { id: 'd', status: 'ACTIVE' },
    policy,
    policy_hash: 'hash',
    assignments: [{ project_id: PROJECT, project_name: 'Alpha', color: '#000', client_name: null, tasks: [], breaks: [] }],
    current_session: null,
    today_seconds: 0,
    week_seconds: 0,
    timesheet_due: null,
    next_shift: null,
    break_types: [],
  };
  a.startMonitors = vi.fn();
  a.sync = vi.fn(async () => undefined);
  a.emitState = vi.fn();
  return agent;
}

describe('starting the timer', () => {
  it('starts without the worker acknowledging the monitoring policy (the disclosure screen was removed)', async () => {
    const agent = readyAgent();
    await agent.start(PROJECT, null);
    const queue = agent.queue as unknown as { events: Array<{ type: string; project_id?: string }> };
    expect(queue.events.map((e) => e.type)).toEqual(['session.start']);
    expect(queue.events[0]!.project_id).toBe(PROJECT);
  });

  it('still refuses when the organization disables desktop tracking', async () => {
    const agent = readyAgent({ ...DEFAULT_POLICY, tracking: { ...DEFAULT_POLICY.tracking, allowDesktop: false } });
    await expect(agent.start(PROJECT, null)).rejects.toThrow('Desktop tracking is disabled by your organization');
    expect((agent.queue as unknown as { events: unknown[] }).events).toEqual([]);
  });
});

describe('picking what is already being tracked', () => {
  const events = (agent: InstanceType<typeof Agent>) => (agent.queue as unknown as { events: Array<{ type: string; session_id: string }> }).events;
  const sessionOf = (agent: InstanceType<typeof Agent>) => (agent as unknown as { session: { id: string; state: string; startedAt: string } | null }).session;

  it('keeps the running session when the same project is clicked again (regression: the Home timer restarted)', async () => {
    const agent = readyAgent();
    await agent.start(PROJECT, null);
    const before = { ...sessionOf(agent)! };
    await agent.start(PROJECT, null);
    expect(sessionOf(agent)).toMatchObject({ id: before.id, startedAt: before.startedAt, state: 'active' });
    expect(events(agent).map((e) => e.type)).toEqual(['session.start']);
  });

  it('resumes a paused session of that project instead of starting a new one', async () => {
    const agent = readyAgent();
    await agent.start(PROJECT, null);
    const id = sessionOf(agent)!.id;
    agent.pause('MANUAL');
    await agent.start(PROJECT, null);
    expect(sessionOf(agent)).toMatchObject({ id, state: 'active' });
    expect(events(agent).map((e) => e.type)).toEqual(['session.start', 'session.pause', 'session.resume']);
  });

  it('does not resume an idle pause: the worker answers the idle prompt first', async () => {
    const agent = readyAgent();
    await agent.start(PROJECT, null);
    agent.pause('IDLE');
    (agent as unknown as { idle: unknown }).idle = { idleId: 'i', startedAt: Date.now(), endedAt: null };
    await agent.start(PROJECT, null);
    expect(sessionOf(agent)!.state).toBe('paused');
    expect(events(agent).map((e) => e.type)).toEqual(['session.start', 'session.pause']);
  });

  it('still switches when another task or project is picked', async () => {
    const agent = readyAgent();
    await agent.start(PROJECT, null);
    const first = sessionOf(agent)!.id;
    await agent.start(PROJECT, '0190a000-0000-7000-8000-000000000002');
    expect(sessionOf(agent)!.id).not.toBe(first);
    expect(events(agent).map((e) => e.type)).toEqual(['session.start', 'session.stop', 'session.start']);
  });
});
