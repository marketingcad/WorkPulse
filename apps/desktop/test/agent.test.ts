import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ desktopCapturer: {}, nativeImage: {}, screen: {} }));
const { ActivityMonitor, msUntilNextShotSlot, nextShotDelays } = await import('../src/main/services/monitors');
const { IPC } = await import('../src/shared/ipc');
const { manualRequestError, reminderKey } = await import('../src/main/services/manual');
const { DEFAULT_POLICY } = await import('@tallywork/domain');
const { limitAction, shiftReminder } = await import('../src/main/services/reminders');

describe('privacy contract', () => {
  it('input hook callbacks never read event data (no key codes, no characters, no positions)', () => {
    const src = readFileSync(path.join(__dirname, '../src/main/services/monitors.ts'), 'utf8');
    // Callbacks are declared without parameters, so the event object is never touched.
    expect(src).toMatch(/const markKey = \(\) =>/);
    expect(src).toMatch(/const markMouse = \(\) =>/);
    expect(src).not.toMatch(/keycode|keychar|rawcode|\.x\b|\.y\b/i);
  });
});

describe('activity minutes', () => {
  it('produces count-only minute buckets with active seconds bounded by tracked seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T09:00:10Z'));
    const m = new ActivityMonitor();
    m.start();
    const mark = (m as unknown as { mark(): void }).mark.bind(m);
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(1000);
      mark();
    }
    vi.setSystemTime(new Date('2026-09-25T09:01:30Z'));
    const minutes = m.stop();
    expect(minutes.length).toBeGreaterThanOrEqual(1);
    const first = minutes[0]!;
    expect(first.minute_start).toBe('2026-09-25T09:00:00.000Z');
    expect(first.tracked_seconds).toBe(50);
    expect(first.active_seconds).toBeLessThanOrEqual(first.tracked_seconds);
    expect(Object.keys(first).sort()).toEqual(['active_seconds', 'keyboard', 'minute_start', 'mouse', 'tracked_seconds']);
    vi.useRealTimers();
  });

  it('closes every skipped minute when the roll timer fires late, with no gaps or overlaps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T09:00:10Z'));
    const m = new ActivityMonitor();
    m.start();
    const mark = (m as unknown as { mark(): void }).mark.bind(m);
    mark();
    // Timer starved (e.g. event loop blocked) for ~3 minutes, then the agent stops at 09:03:20.
    vi.setSystemTime(new Date('2026-09-25T09:03:20Z'));
    const minutes = m.stop();
    expect(minutes.map((b) => b.minute_start)).toEqual([
      '2026-09-25T09:00:00.000Z',
      '2026-09-25T09:01:00.000Z',
      '2026-09-25T09:02:00.000Z',
      '2026-09-25T09:03:00.000Z',
    ]);
    expect(minutes.map((b) => b.tracked_seconds)).toEqual([50, 60, 60, 20]);
    expect(minutes.map((b) => b.active_seconds)).toEqual([1, 0, 0, 0]);
    vi.useRealTimers();
  });
});

describe('screenshot scheduling', () => {
  it('captures in the rest of the current 10-minute slot, one per remaining part', () => {
    const at = (iso: string) => Date.parse(`2026-09-25T${iso}Z`);
    const now = at('09:03:00');
    for (let run = 0; run < 50; run++) {
      // 1 per 10 min, started at :03 → one capture between :03 and :10 (not deferred to the next slot).
      const [d, ...rest] = nextShotDelays(1, now);
      expect(rest).toEqual([]);
      expect(now + d!).toBeGreaterThan(now);
      expect(now + d!).toBeLessThan(at('09:10:00'));
      // 3 per 10 min → parts :00–:03:20 (ends soon), :03:20–:06:40, :06:40–:10.
      const three = nextShotDelays(3, now).map((x) => now + x);
      expect(three).toHaveLength(3);
      expect(three[0]!).toBeLessThan(at('09:03:20'));
      expect(three[1]!).toBeGreaterThanOrEqual(at('09:03:20'));
      expect(three[1]!).toBeLessThan(at('09:06:40'));
      expect(three[2]!).toBeGreaterThanOrEqual(at('09:06:40'));
      expect(three[2]!).toBeLessThan(at('09:10:00'));
    }
    // Parts that already ended are skipped; less than the minimum delay left → no capture.
    expect(nextShotDelays(3, at('09:07:00'))).toHaveLength(1);
    expect(nextShotDelays(1, at('09:09:59.500'))).toEqual([]);
    expect(nextShotDelays(0, now)).toEqual([]);
  });

  it('re-plans exactly at the next slot boundary', () => {
    expect(msUntilNextShotSlot(Date.parse('2026-09-25T09:03:00Z'))).toBe(7 * 60_000);
    expect(msUntilNextShotSlot(Date.parse('2026-09-25T09:10:00Z'))).toBe(10 * 60_000);
  });
});

describe('IPC contract', () => {
  it('rejects malformed payloads', () => {
    expect(IPC['timer:start'].safeParse({ projectId: 'not-a-uuid', taskId: null }).success).toBe(false);
    expect(IPC['app:openWeb'].safeParse({ path: 'https://evil.test' }).success).toBe(false);
    expect(IPC['app:openWeb'].safeParse({ path: '/o/123/activity' }).success).toBe(true);
    expect(IPC['auth:login'].safeParse({ serverUrl: 'javascript:alert(1)' }).success).toBe(false);
  });
});

describe('manual time requests', () => {
  const project = { project_id: '0190a000-0000-7000-8000-000000000001', project_name: 'Alpha', color: '#000', client_name: null, tasks: [{ id: '0190a000-0000-7000-8000-000000000002', title: 'Design', status: 'OPEN' }] };
  const now = Date.parse('2026-09-25T18:00:00Z');
  const req = (o: Record<string, unknown> = {}) => ({ projectId: project.project_id, taskId: null, startedAt: '2026-09-25T13:00:00Z', endedAt: '2026-09-25T14:00:00Z', reason: 'Workshop', ...o });

  it('validates locally before queueing (the server re-checks on delivery)', () => {
    expect(manualRequestError(req(), DEFAULT_POLICY, [project], now)).toBeNull();
    expect(manualRequestError(req({ taskId: project.tasks[0]!.id }), DEFAULT_POLICY, [project], now)).toBeNull();
    expect(manualRequestError(req({ projectId: '0190a000-0000-7000-8000-000000000009' }), DEFAULT_POLICY, [project], now)).toMatch(/not assigned/);
    expect(manualRequestError(req({ taskId: '0190a000-0000-7000-8000-000000000009' }), DEFAULT_POLICY, [project], now)).toMatch(/task/);
    expect(manualRequestError(req({ endedAt: '2026-09-25T12:00:00Z' }), DEFAULT_POLICY, [project], now)).toMatch(/after start/);
    expect(manualRequestError(req({ endedAt: '2026-09-25T19:00:00Z' }), DEFAULT_POLICY, [project], now)).toMatch(/future/);
    expect(manualRequestError(req({ startedAt: '2026-09-24T12:00:00Z' }), DEFAULT_POLICY, [project], now)).toMatch(/24 hours/);
    expect(manualRequestError(req({ reason: '  ' }), DEFAULT_POLICY, [project], now)).toMatch(/reason/);
    const noReason = { ...DEFAULT_POLICY, manualTime: { ...DEFAULT_POLICY.manualTime, reasonRequired: false } };
    expect(manualRequestError(req({ reason: '' }), noReason, [project], now)).toBeNull();
    const off = { ...DEFAULT_POLICY, manualTime: { ...DEFAULT_POLICY.manualTime, allowed: false } };
    expect(manualRequestError(req(), off, [project], now)).toMatch(/disabled/);
  });

  it('IPC payload is strict', () => {
    expect(IPC['manualTime:request'].safeParse(req()).success).toBe(true);
    expect(IPC['manualTime:request'].safeParse(req({ startedAt: 'yesterday' })).success).toBe(false);
    expect(IPC['manualTime:request'].safeParse(req({ reason: 'x'.repeat(501) })).success).toBe(false);
    expect(IPC['manualTime:request'].safeParse({ ...req(), projectId: 'nope' }).success).toBe(false);
  });

  it('reminds about a due timesheet at most once per period per day', () => {
    expect(reminderKey(null, '2026-09-25')).toBeNull();
    const a = reminderKey({ period_start: '2026-09-14' }, '2026-09-25');
    expect(a).toBe(reminderKey({ period_start: '2026-09-14' }, '2026-09-25'));
    expect(a).not.toBe(reminderKey({ period_start: '2026-09-14' }, '2026-09-26'));
    expect(a).not.toBe(reminderKey({ period_start: '2026-09-21' }, '2026-09-25'));
  });
});

describe('shift reminders and limit warnings', () => {
  const shift = { starts_at: '2026-09-28T13:00:00.000Z' };
  const at = (iso: string) => Date.parse(iso);

  it('reminds once, from 10 minutes before the shift until it starts, only when not tracking', () => {
    expect(shiftReminder(shift, false, at('2026-09-28T12:49:00Z'), null)).toBeNull();
    const key = shiftReminder(shift, false, at('2026-09-28T12:52:00Z'), null);
    expect(key).toBe('shift|2026-09-28T13:00:00.000Z');
    expect(shiftReminder(shift, false, at('2026-09-28T12:55:00Z'), key)).toBeNull();
    expect(shiftReminder(shift, true, at('2026-09-28T12:55:00Z'), null)).toBeNull();
    expect(shiftReminder(shift, false, at('2026-09-28T13:00:00Z'), null)).toBeNull();
    expect(shiftReminder(null, false, at('2026-09-28T12:55:00Z'), null)).toBeNull();
  });

  it('warns once 15 minutes before a limit, then stops at it', () => {
    const limits = { dailySeconds: 8 * 3600, weeklySeconds: 40 * 3600 };
    expect(limitAction(limits, 7 * 3600, 20 * 3600, '2026-09-28', null)).toBeNull();
    const warn = limitAction(limits, 7.8 * 3600, 20 * 3600, '2026-09-28', null);
    expect(warn).toMatchObject({ action: 'warn', kind: 'daily', remainingSeconds: 720 });
    expect(limitAction(limits, 7.9 * 3600, 20 * 3600, '2026-09-28', warn!.key)).toBeNull();
    expect(limitAction(limits, 7.9 * 3600, 20 * 3600, '2026-09-29', warn!.key)).toMatchObject({ action: 'warn' });
    expect(limitAction(limits, 8 * 3600, 20 * 3600, '2026-09-28', warn!.key)).toMatchObject({ action: 'stop', kind: 'daily' });
    expect(limitAction(limits, 2 * 3600, 39.9 * 3600, '2026-09-28', null)).toMatchObject({ action: 'warn', kind: 'weekly' });
    expect(limitAction({ dailySeconds: null, weeklySeconds: null }, 99999, 99999, '2026-09-28', null)).toBeNull();
  });
});

describe('managed configuration (MDM / Group Policy)', async () => {
  const { parseDefaultsRead, parseJsonConfig, parseRegQuery } = await import('../src/main/services/managed-config');
  it('reads the Windows registry policy', () => {
    const out = '\r\nHKEY_LOCAL_MACHINE\SOFTWARE\Policies\Tallywork\r\n    ServerUrl    REG_SZ    https://time.acme.com/\r\n    UpdateChannel    REG_SZ    beta\r\n    LaunchAtLogin    REG_DWORD    0x1\r\n';
    expect(parseRegQuery(out)).toEqual({ serverUrl: 'https://time.acme.com', updateChannel: 'beta', launchAtLogin: true });
    expect(parseRegQuery('')).toEqual({});
  });
  it('reads a macOS configuration profile', () => {
    const out = '{\n    LaunchAtLogin = 0;\n    ServerUrl = "https://time.acme.com";\n    UpdateChannel = latest;\n}\n';
    expect(parseDefaultsRead(out)).toEqual({ serverUrl: 'https://time.acme.com', updateChannel: 'latest', launchAtLogin: false });
  });
  it('reads /etc/tallywork/config.json and ignores unsafe or invalid values', () => {
    expect(parseJsonConfig('{"serverUrl":"https://time.acme.com/x","launchAtLogin":true}')).toEqual({ serverUrl: 'https://time.acme.com', launchAtLogin: true });
    expect(parseJsonConfig('{"serverUrl":"http://evil.example","updateChannel":"nightly"}')).toEqual({});
    expect(parseJsonConfig('not json')).toEqual({});
  });
});
