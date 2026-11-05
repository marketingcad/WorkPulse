import type { EndReason, SessionTrigger } from '@tallywork/domain';

/**
 * Session history in plain words (the audit found raw system terms: "Superseded", "Never confirmed",
 * "Auto pause timeout", "by Agent · Confirm timeout"). Unknown values fall back to readable text.
 */
const readable = (v: string) => v.replace(/[_-]+/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

const END: Record<EndReason, string> = {
  USER: 'Stopped by the member',
  NEVER_CONFIRMED: 'The desktop app never confirmed it started',
  AUTO_PAUSE_TIMEOUT: 'Stopped after a long pause',
  INTERRUPTED: 'Stopped: the app was offline too long',
  LIMIT: 'Stopped at a time limit',
  SUPERSEDED: 'Replaced by a timer started elsewhere',
  ADMIN: 'Stopped by a manager',
};

const TRIGGER: Record<SessionTrigger, string> = {
  CONFIRM: 'App confirmed',
  PAUSE: 'Paused',
  RESUME: 'Resumed',
  STOP: 'Stopped',
  INTERRUPT: 'Lost contact',
  RECOVER: 'Picked up again',
  CONFIRM_TIMEOUT: 'Never confirmed by the app',
  PAUSE_TIMEOUT: 'Paused too long',
  RECOVERY_TIMEOUT: 'Offline too long',
  LIMIT_REACHED: 'Time limit reached',
  SUPERSEDE: 'Replaced by a newer timer',
  FORCE_STOP: 'Stopped by a manager',
};

const ACTOR: Record<string, string> = { user: 'a person', agent: 'the desktop app', system: 'WorkPulse, automatically', api: 'an integration' };

const CAUSE: Record<string, string> = {
  heartbeat_lost: 'the desktop app stopped responding',
  device_confirmed: 'the desktop app confirmed it was running',
  never_confirmed: 'the desktop app was online but not running this timer',
  offline_sync: 'time sent after being offline',
  admin_force_stop: 'stopped from Live',
  task_switch: 'switched project or task',
  user_pause: 'paused by the member',
  idle: 'away from the computer',
  crash: 'the app closed unexpectedly',
  confirm_timeout: 'the app did not confirm in time',
};

export const endReasonLabel = (r: string | null | undefined) => (r ? (END[r as EndReason] ?? readable(r)) : '—');
export const triggerLabel = (t: string) => TRIGGER[t as SessionTrigger] ?? readable(t);
export const actorLabel = (a: string) => ACTOR[a.toLowerCase()] ?? readable(a).toLowerCase();
export function causeLabel(c: string): string {
  if (CAUSE[c]) return CAUSE[c];
  if (c.startsWith('superseded_by_')) return `a timer was started on the ${c.slice('superseded_by_'.length)}`;
  if (c.startsWith('idle_')) return `away from the computer (${readable(c.slice(5)).toLowerCase()})`;
  return readable(c).toLowerCase();
}
