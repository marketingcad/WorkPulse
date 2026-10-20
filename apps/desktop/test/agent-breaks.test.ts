import { beforeEach, describe, expect, it, vi } from 'vitest';

// The agent core with its OS-facing pieces replaced: no Electron, no disk, no network, no monitors.
const notifications: Array<{ title: string; click?: () => void }> = [];
const stored = new Map<string, unknown>();
vi.mock('electron', () => ({
  Notification: class {
    private click?: () => void;
    constructor(private readonly o: { title: string }) {}
    on(_e: string, cb: () => void) {
      this.click = cb;
    }
    show() {
      notifications.push({ title: this.o.title, click: this.click });
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
    readJson = (k: string) => stored.get(k) ?? null;
    writeJson = (k: string, v: unknown) => void stored.set(k, v);
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
    some() {
      return false;
    }
  },
}));

const { Agent } = await import('../src/main/services/agent');
const { IPC } = await import('../src/shared/ipc');
const { breakOver, breakReminder, localClock } = await import('../src/main/services/reminders');
const { DEFAULT_POLICY } = await import('@tallywork/domain');

const PROJECT = '0190a000-0000-7000-8000-000000000001';
const COFFEE = '0190a000-0000-7000-8000-0000000000c0';
const LUNCH = '0190a000-0000-7000-8000-0000000000a0';

function readyAgent() {
  const agent = new Agent('http://127.0.0.1:3100', '0.0.0-test');
  const a = agent as unknown as Record<string, unknown>;
  a.boot = {
    organization: { id: 'org', name: 'Org', timezone: 'UTC' },
    worker: { membership_id: 'm', name: 'Worker', email: 'w@example.test', timezone: 'UTC' },
    device: { id: 'd', status: 'ACTIVE' },
    policy: { ...DEFAULT_POLICY, limits: { dailySeconds: null, weeklySeconds: null } },
    policy_hash: 'hash',
    assignments: [
      {
        project_id: PROJECT,
        project_name: 'Alpha',
        color: '#000',
        client_name: null,
        tasks: [],
        breaks: [
          { break_type_id: COFFEE, name: 'Coffee', paid: true, start_time: '10:30', duration_minutes: 15 },
          { break_type_id: LUNCH, name: 'Lunch', paid: false, start_time: '12:00', duration_minutes: 60 },
        ],
      },
    ],
    current_session: null,
    today_seconds: 0,
    week_seconds: 0,
    timesheet_due: null,
    next_shift: null,
    break_types: [
      { id: COFFEE, name: 'Coffee', paid: true, max_minutes: 15 },
      { id: LUNCH, name: 'Lunch', paid: false, max_minutes: 45 },
    ],
  };
  a.startMonitors = vi.fn();
  a.stopMonitors = vi.fn();
  a.flushObservations = vi.fn();
  a.sync = vi.fn(async () => undefined);
  a.emitState = vi.fn();
  return agent;
}

const events = (agent: InstanceType<typeof Agent>) => (agent.queue as unknown as { events: Array<Record<string, unknown>> }).events;
const checkReminders = (agent: InstanceType<typeof Agent>) => (agent as unknown as { checkReminders: () => void }).checkReminders();

beforeEach(() => {
  notifications.length = 0;
  stored.clear();
  vi.useRealTimers();
});

describe('clocking out with an end-of-day report', () => {
  it('sends the report with the stop, so it is kept offline too', async () => {
    const agent = readyAgent();
    await agent.start(PROJECT, null);
    await agent.stop(new Date(), { text: 'Closed 14 tickets', finished: true });
    expect(events(agent).map((e) => e.type)).toEqual(['session.start', 'session.stop']);
    expect(events(agent)[1]!.report).toEqual({ text: 'Closed 14 tickets', finished: true });
  });

  it('a stop without a report (quit, sleep, sign-out) sends none', async () => {
    const agent = readyAgent();
    await agent.start(PROJECT, null);
    await agent.stop();
    expect(events(agent)[1]).not.toHaveProperty('report');
  });
});

describe('breaks', () => {
  it('a planned break uses its own length; the countdown starts when it is taken; clocking back in ends it', async () => {
    const agent = readyAgent();
    await agent.start(PROJECT, null);
    agent.takeBreak(LUNCH, 60);
    const st = agent.state();
    expect(st.tracking.state).toBe('paused');
    expect(st.breakTypeId).toBe(LUNCH);
    expect(st.breakMinutes).toBe(60);
    expect(Date.now() - Date.parse(st.breakStartedAt!)).toBeLessThan(1000);
    expect(events(agent)[1]).toMatchObject({ type: 'session.pause', kind: 'BREAK', break_type_id: LUNCH });
    agent.resume();
    expect(agent.state()).toMatchObject({ breakStartedAt: null, breakMinutes: null, breakTypeId: null });
  });

  it('a break from the Break menu falls back to the break type’s maximum; a plain pause has no length', async () => {
    const agent = readyAgent();
    await agent.start(PROJECT, null);
    agent.takeBreak(LUNCH);
    expect(agent.state().breakMinutes).toBe(45);
    agent.resume();
    agent.pause('MANUAL');
    expect(agent.state().breakMinutes).toBeNull();
    expect(agent.state().breakStartedAt).not.toBeNull();
  });

  it('reminds once at a planned break’s time while clocked in; clicking the reminder starts that break', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T11:59:00Z'));
    const agent = readyAgent();
    await agent.start(PROJECT, null);
    checkReminders(agent);
    expect(notifications).toEqual([]);
    vi.setSystemTime(new Date('2026-10-20T12:02:00Z'));
    checkReminders(agent);
    checkReminders(agent);
    expect(notifications.map((n) => n.title)).toEqual(['Lunch break · 12:00']);
    notifications[0]!.click!();
    expect(agent.state()).toMatchObject({ breakTypeId: LUNCH, breakMinutes: 60 });
    expect(agent.state().tracking.state).toBe('paused');
  });

  it('says once when a break with a set length is over', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));
    const agent = readyAgent();
    await agent.start(PROJECT, null);
    agent.takeBreak(COFFEE, 15);
    vi.setSystemTime(new Date('2026-10-20T15:14:00Z'));
    checkReminders(agent);
    expect(notifications).toEqual([]);
    vi.setSystemTime(new Date('2026-10-20T15:16:00Z'));
    checkReminders(agent);
    checkReminders(agent);
    expect(notifications.map((n) => n.title)).toEqual(['Your break is over']);
  });
});

describe('break reminder rules', () => {
  const breaks = [{ start_time: '10:30' }, { start_time: null }, { start_time: '12:00' }];
  const clock = (hhmm: string) => ({ date: '2026-10-20', minutes: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) });

  it('is due from the break’s time for 10 minutes, once a day per break; breaks with no time never remind', () => {
    expect(breakReminder(breaks, 'p', clock('10:29'), [])).toBeNull();
    const due = breakReminder(breaks, 'p', clock('10:30'), []);
    expect(due).toEqual({ index: 0, key: 'break|2026-10-20|p|0' });
    expect(breakReminder(breaks, 'p', clock('10:35'), [due!.key])).toBeNull();
    expect(breakReminder(breaks, 'p', clock('10:40'), [])).toBeNull();
    expect(breakReminder(breaks, 'p', clock('12:09'), [due!.key])).toEqual({ index: 2, key: 'break|2026-10-20|p|2' });
    expect(breakReminder(breaks, 'p', { date: '2026-10-21', minutes: 630 }, [due!.key])).toMatchObject({ index: 0 });
  });

  it('reads the clock in the worker’s time zone', () => {
    expect(localClock(Date.parse('2026-10-20T16:30:00Z'), 'America/New_York')).toEqual({ date: '2026-10-20', minutes: 12 * 60 + 30 });
    expect(localClock(Date.parse('2026-10-20T23:30:00Z'), 'Asia/Manila')).toEqual({ date: '2026-10-21', minutes: 7 * 60 + 30 });
  });

  it('a break is over once its length has run, said once', () => {
    const start = '2026-10-20T12:00:00.000Z';
    expect(breakOver(start, 60, Date.parse('2026-10-20T12:59:00Z'), null)).toBeNull();
    const key = breakOver(start, 60, Date.parse('2026-10-20T13:00:00Z'), null);
    expect(key).toBe(`over|${start}`);
    expect(breakOver(start, 60, Date.parse('2026-10-20T13:05:00Z'), key)).toBeNull();
    expect(breakOver(start, null, Date.parse('2026-10-20T18:00:00Z'), null)).toBeNull();
  });
});

describe('IPC contract for clocking out and breaks', () => {
  it('accepts a stop with or without a report, and rejects an empty or oversized one', () => {
    expect(IPC['timer:stop'].safeParse(undefined).success).toBe(true);
    expect(IPC['timer:stop'].safeParse({ report: { text: 'Done the login page', finished: true } }).success).toBe(true);
    expect(IPC['timer:stop'].safeParse({ report: { text: '   ', finished: false } }).success).toBe(false);
    expect(IPC['timer:stop'].safeParse({ report: { text: 'x'.repeat(5001), finished: false } }).success).toBe(false);
  });

  it('break lengths are whole minutes up to 8 hours', () => {
    expect(IPC['timer:break'].safeParse({ breakTypeId: COFFEE, minutes: 15 }).success).toBe(true);
    expect(IPC['timer:break'].safeParse({ breakTypeId: null }).success).toBe(true);
    expect(IPC['timer:break'].safeParse({ breakTypeId: COFFEE, minutes: 0 }).success).toBe(false);
    expect(IPC['timer:break'].safeParse({ breakTypeId: COFFEE, minutes: 481 }).success).toBe(false);
  });
});
