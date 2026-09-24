import { describe, expect, it } from 'vitest';
import {
  DomainError,
  ROLE_PRESETS,
  SESSION_STATES,
  SESSION_TRIGGERS,
  aggregateWindows,
  amountForSeconds,
  applyUrlPolicy,
  budgetStatus,
  can,
  classifyAttendance,
  crossedThresholds,
  deriveInvoiceStatus,
  detectIdle,
  invoiceTotals,
  ledgerBalance,
  localDate,
  periodFor,
  resolvePolicy,
  resolveRate,
  splitAtLocalMidnight,
  splitOvertime,
  startOfLocalDay,
  timesheetTransition,
  transition,
  visibleMembershipIds,
  type ActorContext,
  type Rate,
} from '../src';

describe('session state machine', () => {
  it('follows the happy path with correct segment ops', () => {
    expect(transition('CREATED', 'CONFIRM')).toMatchObject({ to: 'ACTIVE', segment: { type: 'open', kind: 'WORK' } });
    expect(transition('ACTIVE', 'PAUSE')).toMatchObject({ to: 'PAUSED', segment: { type: 'close_and_open', kind: 'IDLE' } });
    expect(transition('ACTIVE', 'PAUSE', { pauseKind: 'BREAK' }).segment).toEqual({ type: 'close_and_open', kind: 'BREAK' });
    expect(transition('PAUSED', 'RESUME')).toMatchObject({ to: 'ACTIVE', segment: { type: 'close_and_open', kind: 'WORK' } });
    expect(transition('ACTIVE', 'STOP')).toMatchObject({ to: 'STOPPED', endReason: 'USER', segment: { type: 'close' } });
  });

  it('is idempotent for duplicate stop / pause / resume / confirm', () => {
    expect(transition('STOPPED', 'STOP').noop).toBe(true);
    expect(transition('PAUSED', 'PAUSE').noop).toBe(true);
    expect(transition('ACTIVE', 'RESUME').noop).toBe(true);
    expect(transition('ACTIVE', 'CONFIRM').noop).toBe(true);
  });

  it('handles interruption and recovery', () => {
    expect(transition('ACTIVE', 'INTERRUPT')).toMatchObject({ to: 'INTERRUPTED', segment: { type: 'close' } });
    expect(transition('INTERRUPTED', 'RECOVER')).toMatchObject({ to: 'ACTIVE', segment: { type: 'open', kind: 'WORK' } });
    expect(transition('INTERRUPTED', 'RECOVERY_TIMEOUT')).toMatchObject({ to: 'STOPPED', endReason: 'INTERRUPTED', segment: { type: 'none' } });
  });

  it('never leaves STOPPED and every (state, trigger) pair is decided', () => {
    for (const s of SESSION_STATES) {
      for (const t of SESSION_TRIGGERS) {
        try {
          const r = transition(s, t);
          if (s === 'STOPPED') expect(r.to).toBe('STOPPED');
          expect(SESSION_STATES).toContain(r.to);
        } catch (e) {
          expect(e).toBeInstanceOf(DomainError);
          expect((e as DomainError).category).toBe('conflict');
        }
      }
    }
  });

  it('rejects timeouts from the wrong state', () => {
    expect(() => transition('ACTIVE', 'CONFIRM_TIMEOUT')).toThrow(DomainError);
    expect(() => transition('CREATED', 'LIMIT_REACHED')).toThrow(DomainError);
    expect(() => transition('CREATED', 'PAUSE')).toThrow(DomainError);
  });
});

describe('time', () => {
  it('computes local dates across timezones', () => {
    const t = new Date('2026-03-01T03:30:00Z');
    expect(localDate(t, 'UTC')).toBe('2026-03-01');
    expect(localDate(t, 'America/New_York')).toBe('2026-02-28');
    expect(localDate(t, 'Asia/Kolkata')).toBe('2026-03-01');
  });

  it('finds local midnight including DST days', () => {
    expect(startOfLocalDay('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(startOfLocalDay('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(startOfLocalDay('2026-10-04', 'Australia/Adelaide').toISOString()).toBe('2026-10-03T14:30:00.000Z');
  });

  it('splits intervals at local midnight and conserves duration', () => {
    const start = new Date('2026-03-08T02:00:00Z'); // Mar 7 21:00 NY
    const end = new Date('2026-03-09T06:00:00Z'); // Mar 9 02:00 NY (after DST)
    const parts = splitAtLocalMidnight({ start, end }, 'America/New_York');
    expect(parts.map((p) => p.localDate)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    const total = parts.reduce((s, p) => s + (p.end.getTime() - p.start.getTime()), 0);
    expect(total).toBe(end.getTime() - start.getTime());
    // Mar 8 in New York is a 23-hour day
    expect((parts[1]!.end.getTime() - parts[1]!.start.getTime()) / 3600000).toBe(23);
  });
});

describe('activity', () => {
  it('aggregates minutes into 10-minute windows', () => {
    const base = Date.parse('2026-09-25T09:00:00Z');
    const minutes = Array.from({ length: 12 }, (_, i) => ({
      minuteStart: new Date(base + i * 60000),
      keyboardCount: 30,
      mouseCount: 10,
      activeSeconds: i < 5 ? 60 : 30,
      trackedSeconds: 60,
    }));
    const w = aggregateWindows(minutes);
    expect(w).toHaveLength(2);
    expect(w[0]!.activityPct).toBe(75); // (5*60 + 5*30) / 600
    expect(w[0]!.keyboardPct + w[0]!.mousePct).toBe(75);
    expect(w[1]!.activityPct).toBe(50);
  });

  it('detects idle retroactively from the last input', () => {
    const last = new Date('2026-09-25T09:35:00Z');
    expect(detectIdle(last, new Date('2026-09-25T09:38:00Z'), 5)).toBeNull();
    expect(detectIdle(last, new Date('2026-09-25T09:47:00Z'), 5)).toEqual({ start: last, end: new Date('2026-09-25T09:47:00Z') });
  });
});

describe('policy', () => {
  it('resolves org → team → worker overrides', () => {
    const p = resolvePolicy([
      { scope: 'WORKER', scopeId: 'w', doc: { screenshots: { perTenMinutes: 3 } } },
      { scope: 'ORG', scopeId: 'o', doc: { screenshots: { enabled: true, blur: true } } },
      { scope: 'TEAM', scopeId: 't', doc: { idle: { thresholdMinutes: 10 } } },
    ]);
    expect(p.screenshots).toMatchObject({ enabled: true, blur: true, perTenMinutes: 3 });
    expect(p.idle.thresholdMinutes).toBe(10);
    expect(p.idle.behavior).toBe('prompt');
  });

  it('truncates URLs to domain and drops excluded domains', () => {
    const pol = { enabled: true, mode: 'domain' as const, excludedDomains: ['bank.com'] };
    expect(applyUrlPolicy('https://www.github.com/a/b?q=1', pol)).toEqual({ domain: 'github.com', url: null });
    expect(applyUrlPolicy('https://login.bank.com/x', pol)).toBeNull();
    expect(applyUrlPolicy('https://github.com/a?q=1', { ...pol, mode: 'full' })).toEqual({ domain: 'github.com', url: 'https://github.com/a' });
    expect(applyUrlPolicy('chrome://settings', pol)).toBeNull();
  });
});

describe('permissions', () => {
  const manager: ActorContext = {
    membershipId: 'm1',
    grants: ROLE_PRESETS.TEAM_MANAGER,
    managedMembershipIds: new Set(['w1', 'w2']),
    assignedProjectIds: new Set(['p1']),
  };
  it('scopes team managers to their teams', () => {
    expect(can(manager, 'timesheets:approve', { ownerMembershipId: 'w1' })).toBe(true);
    expect(can(manager, 'timesheets:approve', { ownerMembershipId: 'w9' })).toBe(false);
    expect(can(manager, 'projects:read', { projectId: 'p2' })).toBe(false);
    expect(can(manager, 'invoices:manage')).toBe(false);
    expect(visibleMembershipIds(manager, 'screenshots:read')).toEqual(new Set(['m1', 'w1', 'w2']));
  });
  it('limits workers to their own data and agents to ingest', () => {
    const worker: ActorContext = { ...manager, grants: ROLE_PRESETS.WORKER, managedMembershipIds: new Set() };
    expect(can(worker, 'screenshots:read', { ownerMembershipId: 'm1' })).toBe(true);
    expect(can(worker, 'screenshots:read', { ownerMembershipId: 'w1' })).toBe(false);
    expect(ROLE_PRESETS.AGENT['members:read']).toBeUndefined();
    expect(ROLE_PRESETS.AGENT['activity:read']).toBeUndefined();
  });
});

describe('timesheets', () => {
  it('enforces the lifecycle', () => {
    expect(timesheetTransition('DRAFT', 'SUBMIT')).toBe('SUBMITTED');
    expect(timesheetTransition('SUBMITTED', 'REJECT')).toBe('REJECTED');
    expect(timesheetTransition('REJECTED', 'EDIT')).toBe('DRAFT');
    expect(timesheetTransition('APPROVED', 'REOPEN')).toBe('DRAFT');
    expect(() => timesheetTransition('DRAFT', 'APPROVE')).toThrow(DomainError);
  });
  it('computes pay periods', () => {
    expect(periodFor('2026-09-25', { type: 'weekly' }, 1)).toEqual({ start: '2026-09-21', end: '2026-09-27' });
    expect(periodFor('2026-09-25', { type: 'semimonthly' }, 1)).toEqual({ start: '2026-09-16', end: '2026-09-30' });
    expect(periodFor('2026-02-10', { type: 'monthly' }, 1)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    const bw = periodFor('2026-09-25', { type: 'biweekly', anchorDate: '2026-09-14' }, 1);
    expect(bw).toEqual({ start: '2026-09-14', end: '2026-09-27' });
    expect(periodFor('2026-09-10', { type: 'biweekly', anchorDate: '2026-09-14' }, 1)).toEqual({ start: '2026-08-31', end: '2026-09-13' });
  });
});

describe('billing', () => {
  const rates: Rate[] = [
    { id: 'org', kind: 'BILL', scope: 'ORG', scopeId: null, amountMinor: 5000, currency: 'USD', effectiveFrom: '2026-01-01', effectiveTo: null },
    { id: 'proj', kind: 'BILL', scope: 'PROJECT', scopeId: 'p1', amountMinor: 9000, currency: 'USD', effectiveFrom: '2026-01-01', effectiveTo: '2026-07-01' },
    { id: 'proj2', kind: 'BILL', scope: 'PROJECT', scopeId: 'p1', amountMinor: 10000, currency: 'USD', effectiveFrom: '2026-07-01', effectiveTo: null },
    { id: 'pay', kind: 'PAY', scope: 'WORKER', scopeId: 'w1', amountMinor: 3000, currency: 'USD', effectiveFrom: '2026-01-01', effectiveTo: null },
  ];
  it('resolves the most specific effective rate', () => {
    expect(resolveRate(rates, 'BILL', { date: '2026-03-01', membershipId: 'w1', projectId: 'p1', clientId: null })?.id).toBe('proj');
    expect(resolveRate(rates, 'BILL', { date: '2026-08-01', membershipId: 'w1', projectId: 'p1', clientId: null })?.id).toBe('proj2');
    expect(resolveRate(rates, 'BILL', { date: '2026-08-01', membershipId: 'w1', projectId: 'p2', clientId: null })?.id).toBe('org');
    expect(resolveRate(rates, 'PAY', { date: '2026-08-01', membershipId: 'w1', projectId: 'p1', clientId: null })?.id).toBe('pay');
  });
  it('computes amounts, budgets, invoices', () => {
    expect(amountForSeconds(5400, 10000)).toBe(15000);
    expect(budgetStatus({ budget: 1000, spent: 850, warnPct: 80 }).state).toBe('warning');
    expect(budgetStatus({ budget: 1000, spent: 1001, warnPct: 80 }).state).toBe('exceeded');
    expect(crossedThresholds(70, 105, [80, 100])).toEqual([80, 100]);
    const t = invoiceTotals([{ quantity: 1.5, unitPriceMinor: 10000, taxRateBps: 1000 }, { quantity: 1, unitPriceMinor: 2500, taxRateBps: 0 }]);
    expect(t).toMatchObject({ subtotalMinor: 17500, taxMinor: 1500, totalMinor: 19000 });
    expect(deriveInvoiceStatus({ explicit: 'SENT', totalMinor: 100, paidMinor: 50, dueDate: '2026-10-01', today: '2026-09-25' })).toBe('PARTIALLY_PAID');
    expect(deriveInvoiceStatus({ explicit: 'SENT', totalMinor: 100, paidMinor: 50, dueDate: '2026-09-01', today: '2026-09-25' })).toBe('OVERDUE');
    expect(deriveInvoiceStatus({ explicit: 'SENT', totalMinor: 100, paidMinor: 100, dueDate: '2026-09-01', today: '2026-09-25' })).toBe('PAID');
  });
});

describe('workforce', () => {
  it('classifies attendance', () => {
    const r = classifyAttendance({
      scheduledStart: new Date('2026-09-25T09:00:00Z'),
      scheduledEnd: new Date('2026-09-25T17:00:00Z'),
      firstIn: new Date('2026-09-25T09:20:00Z'),
      lastOut: new Date('2026-09-25T16:30:00Z'),
      workedSeconds: 7 * 3600,
      onLeave: false,
      isHoliday: false,
      lateGraceMinutes: 5,
      now: new Date('2026-09-25T20:00:00Z'),
    });
    expect(r).toMatchObject({ status: 'LATE', lateSeconds: 1200, earlyLeaveSeconds: 1800 });
  });
  it('splits overtime daily then weekly', () => {
    expect(splitOvertime([9, 9, 9, 9, 9].map((h) => h * 3600), { dailyThresholdSeconds: null, weeklyThresholdSeconds: 40 * 3600 })).toEqual({ regular: 40 * 3600, overtime: 5 * 3600 });
    expect(splitOvertime([10, 8].map((h) => h * 3600), { dailyThresholdSeconds: 8 * 3600, weeklyThresholdSeconds: null })).toEqual({ regular: 16 * 3600, overtime: 2 * 3600 });
  });
  it('computes ledger balances', () => {
    expect(ledgerBalance([{ hours: 8, kind: 'ACCRUAL' }, { hours: -4, kind: 'REQUEST' }, { hours: 4, kind: 'REVERSAL' }])).toBe(8);
  });
});
