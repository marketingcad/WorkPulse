import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ desktopCapturer: {}, nativeImage: {}, screen: {} }));
const { ActivityMonitor, nextShotDelays } = await import('../src/main/services/monitors');
const { IPC } = await import('../src/shared/ipc');

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
  it('spreads captures randomly inside each future 10-minute slot', () => {
    const now = Date.parse('2026-09-25T09:03:00Z');
    const delays = nextShotDelays(3, now);
    expect(delays).toHaveLength(3);
    for (const d of delays) {
      const t = now + d;
      expect(t).toBeGreaterThanOrEqual(Date.parse('2026-09-25T09:10:00Z'));
      expect(t).toBeLessThan(Date.parse('2026-09-25T09:20:00Z'));
    }
    expect(nextShotDelays(0, now)).toEqual([]);
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
