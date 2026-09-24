/**
 * Activity = input *frequency*, never content. The agent reports one bucket per minute;
 * the server aggregates them into 10-minute windows.
 */

export const WINDOW_MINUTES = 10;
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;

export interface ActivityMinute {
  minuteStart: Date;
  keyboardCount: number;
  mouseCount: number;
  /** seconds in this minute with at least one input event (0..60) */
  activeSeconds: number;
  /** seconds in this minute that were tracked (0..60); partial at session edges */
  trackedSeconds: number;
}

export interface ActivityWindowAgg {
  windowStart: Date;
  activeSeconds: number;
  trackedSeconds: number;
  keyboardCount: number;
  mouseCount: number;
  activityPct: number;
  keyboardPct: number;
  mousePct: number;
}

export function windowStartOf(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / WINDOW_MS) * WINDOW_MS);
}

export function minuteStartOf(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / 60000) * 60000);
}

export function activityPct(activeSeconds: number, trackedSeconds: number): number {
  if (trackedSeconds <= 0) return 0;
  return Math.min(100, Math.round((activeSeconds / trackedSeconds) * 100));
}

export function aggregateWindows(minutes: ActivityMinute[]): ActivityWindowAgg[] {
  const byWindow = new Map<number, ActivityWindowAgg>();
  for (const m of minutes) {
    const ws = windowStartOf(m.minuteStart);
    const key = ws.getTime();
    let w = byWindow.get(key);
    if (!w) {
      w = { windowStart: ws, activeSeconds: 0, trackedSeconds: 0, keyboardCount: 0, mouseCount: 0, activityPct: 0, keyboardPct: 0, mousePct: 0 };
      byWindow.set(key, w);
    }
    const tracked = clamp(m.trackedSeconds, 0, 60);
    w.trackedSeconds += tracked;
    w.activeSeconds += clamp(m.activeSeconds, 0, tracked);
    w.keyboardCount += Math.max(0, m.keyboardCount);
    w.mouseCount += Math.max(0, m.mouseCount);
  }
  const out = [...byWindow.values()].sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime());
  for (const w of out) finalizeWindow(w);
  return out;
}

export function finalizeWindow(w: ActivityWindowAgg): ActivityWindowAgg {
  w.activityPct = activityPct(w.activeSeconds, w.trackedSeconds);
  const inputs = w.keyboardCount + w.mouseCount;
  // Split the activity % between keyboard and mouse by event share.
  w.keyboardPct = inputs === 0 ? 0 : Math.round((w.keyboardCount / inputs) * w.activityPct);
  w.mousePct = inputs === 0 ? 0 : w.activityPct - w.keyboardPct;
  return w;
}

export type ActivityLevel = 'none' | 'low' | 'moderate' | 'good' | 'high';

export function activityLevel(pct: number): ActivityLevel {
  if (pct <= 0) return 'none';
  if (pct < 25) return 'low';
  if (pct < 50) return 'moderate';
  if (pct < 75) return 'good';
  return 'high';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Given the last input time and "now", compute the idle interval if the idle
 * threshold was exceeded. Idle is retroactive: it starts at the last input.
 */
export function detectIdle(
  lastInputAt: Date,
  now: Date,
  thresholdMinutes: number,
): { start: Date; end: Date } | null {
  const idleMs = now.getTime() - lastInputAt.getTime();
  if (idleMs < thresholdMinutes * 60000) return null;
  return { start: lastInputAt, end: now };
}
