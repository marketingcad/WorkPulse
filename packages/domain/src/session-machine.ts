import { conflict } from './errors';

/**
 * Tracking session state machine (see docs/plan/03-data-model.md §8).
 * Pure: given the current state and a trigger it returns the next state plus the
 * segment operation the persistence layer must perform. The server is authoritative.
 */

export const SESSION_STATES = ['CREATED', 'ACTIVE', 'PAUSED', 'INTERRUPTED', 'STOPPED'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const LIVE_STATES: readonly SessionState[] = ['CREATED', 'ACTIVE', 'PAUSED', 'INTERRUPTED'];

export const SESSION_TRIGGERS = [
  'CONFIRM', // agent's first heartbeat for a CREATED session
  'PAUSE', // user pause, idle (policy=pause), break start
  'RESUME', // user resume, idle resolved KEPT, break end
  'STOP', // user stop
  'INTERRUPT', // heartbeat lost, sleep/lock/shutdown, crash evidence
  'RECOVER', // agent reconnected within recovery window
  'CONFIRM_TIMEOUT', // CREATED never confirmed
  'PAUSE_TIMEOUT', // paused longer than max_pause
  'RECOVERY_TIMEOUT', // interrupted longer than recovery window
  'LIMIT_REACHED', // daily/weekly limit
  'SUPERSEDE', // a new session was started elsewhere
  'FORCE_STOP', // admin
] as const;
export type SessionTrigger = (typeof SESSION_TRIGGERS)[number];

export type EndReason =
  | 'USER'
  | 'NEVER_CONFIRMED'
  | 'AUTO_PAUSE_TIMEOUT'
  | 'INTERRUPTED'
  | 'LIMIT'
  | 'SUPERSEDED'
  | 'ADMIN';

export type SegmentKind = 'WORK' | 'IDLE' | 'BREAK';

/** What the persistence layer must do to segments when applying a transition. */
export type SegmentOp =
  | { type: 'none' }
  | { type: 'open'; kind: SegmentKind }
  | { type: 'close' }
  | { type: 'close_and_open'; kind: SegmentKind };

export interface TransitionResult {
  from: SessionState;
  to: SessionState;
  segment: SegmentOp;
  endReason?: EndReason;
  /** true when the trigger is an idempotent repeat that changes nothing */
  noop: boolean;
}

export interface TransitionOptions {
  /** kind of pause, determines the segment that opens while paused */
  pauseKind?: Exclude<SegmentKind, 'WORK'>;
}

const STOP_REASONS: Partial<Record<SessionTrigger, EndReason>> = {
  STOP: 'USER',
  CONFIRM_TIMEOUT: 'NEVER_CONFIRMED',
  PAUSE_TIMEOUT: 'AUTO_PAUSE_TIMEOUT',
  RECOVERY_TIMEOUT: 'INTERRUPTED',
  LIMIT_REACHED: 'LIMIT',
  SUPERSEDE: 'SUPERSEDED',
  FORCE_STOP: 'ADMIN',
};

function result(
  from: SessionState,
  to: SessionState,
  segment: SegmentOp,
  endReason?: EndReason,
  noop = false,
): TransitionResult {
  return endReason ? { from, to, segment, endReason, noop } : { from, to, segment, noop };
}

function invalid(from: SessionState, trigger: SessionTrigger): never {
  throw conflict('invalid_session_transition', `Cannot ${trigger.toLowerCase().replace(/_/g, ' ')} a session that is ${from.toLowerCase()}`, {
    from,
    trigger,
  });
}

export function transition(
  from: SessionState,
  trigger: SessionTrigger,
  opts: TransitionOptions = {},
): TransitionResult {
  // Terminal state: stop-like triggers are idempotent, everything else is invalid.
  if (from === 'STOPPED') {
    if (STOP_REASONS[trigger]) return result(from, 'STOPPED', { type: 'none' }, undefined, true);
    return invalid(from, trigger);
  }

  // Stop-like triggers are valid from every live state.
  const stopReason = STOP_REASONS[trigger];
  if (stopReason) {
    const onlyFrom: Partial<Record<SessionTrigger, SessionState[]>> = {
      CONFIRM_TIMEOUT: ['CREATED'],
      PAUSE_TIMEOUT: ['PAUSED'],
      RECOVERY_TIMEOUT: ['INTERRUPTED'],
      LIMIT_REACHED: ['ACTIVE', 'PAUSED'],
    };
    const allowed = onlyFrom[trigger];
    if (allowed && !allowed.includes(from)) return invalid(from, trigger);
    // CREATED and INTERRUPTED have no open segment.
    const segment: SegmentOp = from === 'ACTIVE' || from === 'PAUSED' ? { type: 'close' } : { type: 'none' };
    return result(from, 'STOPPED', segment, stopReason);
  }

  switch (trigger) {
    case 'CONFIRM':
      if (from === 'CREATED') return result(from, 'ACTIVE', { type: 'open', kind: 'WORK' });
      if (from === 'ACTIVE') return result(from, 'ACTIVE', { type: 'none' }, undefined, true);
      return invalid(from, trigger);

    case 'PAUSE':
      if (from === 'ACTIVE')
        return result(from, 'PAUSED', { type: 'close_and_open', kind: opts.pauseKind ?? 'IDLE' });
      if (from === 'PAUSED') return result(from, 'PAUSED', { type: 'none' }, undefined, true);
      return invalid(from, trigger);

    case 'RESUME':
      if (from === 'PAUSED') return result(from, 'ACTIVE', { type: 'close_and_open', kind: 'WORK' });
      if (from === 'ACTIVE') return result(from, 'ACTIVE', { type: 'none' }, undefined, true);
      return invalid(from, trigger);

    case 'INTERRUPT':
      if (from === 'ACTIVE' || from === 'PAUSED') return result(from, 'INTERRUPTED', { type: 'close' });
      if (from === 'INTERRUPTED') return result(from, 'INTERRUPTED', { type: 'none' }, undefined, true);
      return invalid(from, trigger);

    case 'RECOVER':
      if (from === 'INTERRUPTED') return result(from, 'ACTIVE', { type: 'open', kind: 'WORK' });
      if (from === 'ACTIVE') return result(from, 'ACTIVE', { type: 'none' }, undefined, true);
      return invalid(from, trigger);

    default:
      return invalid(from, trigger);
  }
}

export function isLive(state: SessionState): boolean {
  return LIVE_STATES.includes(state);
}

/** Default timings; overridable per org through tracking policy. */
export const SESSION_DEFAULTS = {
  confirmTimeoutSeconds: 120,
  heartbeatGraceSeconds: 180,
  recoveryWindowSeconds: 15 * 60,
  maxPauseSeconds: 4 * 60 * 60,
  maxOfflineTrackingSeconds: 24 * 60 * 60,
} as const;
