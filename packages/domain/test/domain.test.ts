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
  accrualCredit,
  carryOverExpiry,
  authorizationMatrixMarkdown,
  classifyAttendance,
  cronMatches,
  isDesktopOnly,
  parseCron,
  resolveRange,
  nearestLimit,
  proRataFactor,
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
  it('sends workers (and worker-like custom roles) to the desktop app, not the web workspace', () => {
    expect(isDesktopOnly(ROLE_PRESETS.WORKER)).toBe(true);
    expect(isDesktopOnly({ 'org:read': 'org', 'tracking:track': 'own', 'expenses:create': 'own' })).toBe(true);
    expect(isDesktopOnly(ROLE_PRESETS.TEAM_MANAGER)).toBe(false);
    expect(isDesktopOnly(ROLE_PRESETS.SYSTEM_ADMIN)).toBe(false);
    // A custom finance role that oversees org-wide data keeps the web workspace.
    expect(isDesktopOnly({ ...ROLE_PRESETS.WORKER, 'invoices:read': 'org' })).toBe(false);
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

describe('workforce (Phase 8 gate)', () => {
  const day = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 25, h, m));
  const base = { scheduledStart: day(9), scheduledEnd: day(17), firstIn: null, lastOut: null, workedSeconds: 0, onLeave: false, isHoliday: false, lateGraceMinutes: 5, now: day(20) };
  it.each([
    ['on time', { firstIn: day(9, 4), lastOut: day(17), workedSeconds: 8 * 3600 }, { status: 'PRESENT', lateSeconds: 0, earlyLeaveSeconds: 0, overtimeSeconds: 0 }],
    ['exactly at grace', { firstIn: day(9, 5), lastOut: day(17), workedSeconds: 8 * 3600 }, { status: 'PRESENT', lateSeconds: 0 }],
    ['late past grace', { firstIn: day(9, 6), lastOut: day(17), workedSeconds: 8 * 3600 }, { status: 'LATE', lateSeconds: 360 }],
    ['absent after the shift started', {}, { status: 'ABSENT' }],
    ['not absent yet inside grace', { now: day(9, 3) }, { status: 'UNSCHEDULED' }],
    ['on leave', { onLeave: true }, { status: 'ON_LEAVE' }],
    ['holiday', { isHoliday: true }, { status: 'HOLIDAY' }],
    ['worked on a holiday', { isHoliday: true, firstIn: day(10), lastOut: day(12), workedSeconds: 7200 }, { status: 'LATE' }],
    ['early leave only counted once the shift is over', { firstIn: day(9), lastOut: day(15), workedSeconds: 6 * 3600, now: day(16) }, { earlyLeaveSeconds: 0 }],
    ['early leave', { firstIn: day(9), lastOut: day(15), workedSeconds: 6 * 3600 }, { status: 'PRESENT', earlyLeaveSeconds: 2 * 3600 }],
    ['overtime beyond the shift', { firstIn: day(9), lastOut: day(19), workedSeconds: 10 * 3600 }, { overtimeSeconds: 2 * 3600 }],
    ['unscheduled work', { scheduledStart: null, scheduledEnd: null, firstIn: day(9), workedSeconds: 3600 }, { status: 'PRESENT', scheduledSeconds: 0 }],
  ])('attendance: %s', (_name, o, expected) => {
    expect(classifyAttendance({ ...base, ...o } as Parameters<typeof classifyAttendance>[0])).toMatchObject(expected);
  });

  it('configurable overtime: daily first, weekly on the remaining regular hours', () => {
    const week = [10, 10, 8, 8, 8, 4].map((h) => h * 3600); // 48h
    expect(splitOvertime(week, { dailyThresholdSeconds: 8 * 3600, weeklyThresholdSeconds: 40 * 3600 })).toEqual({ regular: 40 * 3600, overtime: 8 * 3600 });
    expect(splitOvertime(week, { dailyThresholdSeconds: null, weeklyThresholdSeconds: null })).toEqual({ regular: 48 * 3600, overtime: 0 });
    expect(splitOvertime(week, { dailyThresholdSeconds: 9 * 3600, weeklyThresholdSeconds: 45 * 3600 })).toEqual({ regular: 45 * 3600, overtime: 3 * 3600 });
  });

  it('accrual: monthly/annual credit, per hour worked, and the balance cap', () => {
    const monthly = { type: 'monthly' as const, amountHours: 8, maxBalanceHours: null, carryOverHours: null };
    expect(accrualCredit(monthly, 100)).toBe(8);
    expect(accrualCredit({ ...monthly, maxBalanceHours: 20 }, 16)).toBe(4);
    expect(accrualCredit({ ...monthly, maxBalanceHours: 20 }, 25)).toBe(0);
    expect(accrualCredit({ type: 'per_hour_worked', amountHours: 0.0385, maxBalanceHours: null, carryOverHours: null }, 0, 40)).toBe(1.54);
  });

  it('accrual: pro-rata for members who join mid-period', () => {
    expect(proRataFactor('2026-09-01', '2026-09-30', '2026-08-15')).toBe(1);
    expect(proRataFactor('2026-09-01', '2026-09-30', '2026-09-01')).toBe(1);
    expect(proRataFactor('2026-09-01', '2026-09-30', '2026-09-16')).toBe(0.5);
    expect(proRataFactor('2026-09-01', '2026-09-30', '2026-09-30')).toBe(0.0333);
    expect(proRataFactor('2026-09-01', '2026-09-30', '2026-10-01')).toBe(0);
    expect(proRataFactor('2026-01-01', '2026-12-31', '2026-07-02')).toBe(0.5014);
  });

  it('accrual: carry-over cap at year end', () => {
    expect(carryOverExpiry(60, 40)).toBe(20);
    expect(carryOverExpiry(30, 40)).toBe(0);
    expect(carryOverExpiry(60, null)).toBe(0);
    expect(carryOverExpiry(12.5, 0)).toBe(12.5);
  });

  it('limits: the nearest limit and its remaining time', () => {
    expect(nearestLimit({ dailySeconds: null, weeklySeconds: null }, 100, 100)).toBeNull();
    expect(nearestLimit({ dailySeconds: 8 * 3600, weeklySeconds: 40 * 3600 }, 7 * 3600, 39.5 * 3600)).toEqual({ kind: 'weekly', limitSeconds: 40 * 3600, remainingSeconds: 1800 });
    expect(nearestLimit({ dailySeconds: 8 * 3600, weeklySeconds: null }, 8.5 * 3600, 0)).toMatchObject({ kind: 'daily', remainingSeconds: -1800 });
  });
});

describe('money (Phase 9 gate)', () => {
  it('rounds per entry, half-up to the minor unit (documented rule)', () => {
    expect(amountForSeconds(1800, 12345)).toBe(6173); // 6172.5 → 6173
    expect(amountForSeconds(1, 12345)).toBe(3); // 3.43 → 3
    expect(amountForSeconds(0, 12345)).toBe(0);
    expect(amountForSeconds(24 * 3600, 100_000_000)).toBe(2_400_000_000); // large values stay exact
  });

  it('computes tax per line, then sums (which can differ from tax on the total)', () => {
    const lines = [{ quantity: 1, unitPriceMinor: 5, taxRateBps: 1000 }, { quantity: 1, unitPriceMinor: 5, taxRateBps: 1000 }];
    const t = invoiceTotals(lines);
    expect(t.lines.map((l) => l.taxMinor)).toEqual([1, 1]); // 0.5 → 1 each
    expect(t).toMatchObject({ subtotalMinor: 10, taxMinor: 2, totalMinor: 12 });
    expect(Math.round((10 * 1000) / 10000)).toBe(1); // on the total it would be 1
  });

  it('resolves rates by precedence and effective dates (end exclusive)', () => {
    const r = (id: string, kind: 'BILL' | 'PAY', scope: 'ORG' | 'CLIENT' | 'PROJECT' | 'WORKER' | 'PROJECT_WORKER', scopeId: string | null, from = '2026-01-01', to: string | null = null) => ({ id, kind, scope, scopeId, amountMinor: 1, currency: 'USD', effectiveFrom: from, effectiveTo: to });
    const rates = [r('org', 'BILL', 'ORG', null), r('client', 'BILL', 'CLIENT', 'c'), r('worker', 'BILL', 'WORKER', 'm'), r('project', 'BILL', 'PROJECT', 'p', '2026-01-01', '2026-06-01'), r('pw', 'BILL', 'PROJECT_WORKER', 'p:m', '2026-09-01'), r('pay-project', 'PAY', 'PROJECT', 'p'), r('pay-worker', 'PAY', 'WORKER', 'm')];
    const ctx = (date: string) => ({ date, membershipId: 'm', projectId: 'p', clientId: 'c' });
    expect(resolveRate(rates, 'BILL', ctx('2026-03-01'))!.id).toBe('project');
    expect(resolveRate(rates, 'BILL', ctx('2026-06-01'))!.id).toBe('worker'); // project rate ended (exclusive)
    expect(resolveRate(rates, 'BILL', ctx('2026-09-01'))!.id).toBe('pw');
    expect(resolveRate(rates, 'BILL', { date: '2026-03-01', membershipId: 'x', projectId: 'q', clientId: 'c' })!.id).toBe('client');
    expect(resolveRate(rates, 'BILL', { date: '2026-03-01', membershipId: 'x', projectId: 'q', clientId: null })!.id).toBe('org');
    expect(resolveRate(rates, 'PAY', ctx('2026-03-01'))!.id).toBe('pay-worker'); // pay: worker before project
    expect(resolveRate([r('pay-client', 'PAY', 'CLIENT', 'c'), r('pay-org', 'PAY', 'ORG', null)], 'PAY', ctx('2026-03-01'))!.id).toBe('pay-client'); // pay: client before org
    expect(resolveRate(rates, 'BILL', ctx('2025-12-31'))).toBeNull();
  });

  it.each([
    [{ explicit: 'DRAFT', totalMinor: 100, paidMinor: 0, dueDate: '2026-09-01', today: '2026-09-25' }, 'DRAFT'],
    [{ explicit: 'VOID', totalMinor: 100, paidMinor: 0, dueDate: '2026-09-01', today: '2026-09-25' }, 'VOID'],
    [{ explicit: 'SENT', totalMinor: 100, paidMinor: 0, dueDate: '2026-09-30', today: '2026-09-25' }, 'SENT'],
    [{ explicit: 'SENT', totalMinor: 100, paidMinor: 40, dueDate: '2026-09-30', today: '2026-09-25' }, 'PARTIALLY_PAID'],
    [{ explicit: 'SENT', totalMinor: 100, paidMinor: 40, dueDate: '2026-09-24', today: '2026-09-25' }, 'OVERDUE'],
    [{ explicit: 'SENT', totalMinor: 100, paidMinor: 0, dueDate: '2026-09-25', today: '2026-09-25' }, 'SENT'],
    [{ explicit: 'SENT', totalMinor: 100, paidMinor: 100, dueDate: '2026-09-01', today: '2026-09-25' }, 'PAID'],
  ] as const)('invoice status %#', (input, expected) => {
    expect(deriveInvoiceStatus(input)).toBe(expected);
  });

  it('budget thresholds: each level crossed once', () => {
    expect(crossedThresholds(0, 85, [80, 100])).toEqual([80]);
    expect(crossedThresholds(80, 95, [80, 100])).toEqual([]);
    expect(crossedThresholds(80, 120, [80, 100])).toEqual([100]);
    expect(crossedThresholds(0, 120, [80, 100])).toEqual([80, 100]);
  });
});

describe('report schedules (Phase 11 gate)', () => {
  const at = (iso: string) => new Date(iso);
  it('parses 5-field cron and rejects invalid expressions', () => {
    expect(parseCron('0 8 * * 1')).not.toBeNull();
    expect(parseCron('*/15 9-17 * * 1-5')).not.toBeNull();
    expect(parseCron('30 7 1,15 * *')).not.toBeNull();
    for (const bad of ['', '* * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '* * * * 8', 'a * * * *', '*/0 * * * *', '5-1 * * * *']) expect(parseCron(bad), bad).toBeNull();
  });

  it('matches in the schedule time zone, including DST and Sunday as 0 or 7', () => {
    const mon8 = parseCron('0 8 * * 1')!;
    expect(cronMatches(mon8, at('2026-09-28T12:00:00Z'), 'America/New_York')).toBe(true); // EDT
    expect(cronMatches(mon8, at('2026-11-02T13:00:00Z'), 'America/New_York')).toBe(true); // EST after the change
    expect(cronMatches(mon8, at('2026-11-02T12:00:00Z'), 'America/New_York')).toBe(false);
    expect(cronMatches(mon8, at('2026-09-28T12:00:00Z'), 'Asia/Kolkata')).toBe(false);
    expect(cronMatches(parseCron('30 17 * * *')!, at('2026-09-28T12:00:00Z'), 'Asia/Kolkata')).toBe(true); // UTC+5:30
    expect(cronMatches(parseCron('0 9 * * 7')!, at('2026-09-27T13:00:00Z'), 'America/New_York')).toBe(true);
    expect(cronMatches(parseCron('0 9 * * 0')!, at('2026-09-27T13:00:00Z'), 'America/New_York')).toBe(true);
  });

  it('uses the cron day rule: day-of-month OR day-of-week when both are set', () => {
    const c = parseCron('0 9 1 * 1')!; // the 1st, or any Monday
    expect(cronMatches(c, at('2026-10-01T13:00:00Z'), 'America/New_York')).toBe(true); // Thursday the 1st
    expect(cronMatches(c, at('2026-10-05T13:00:00Z'), 'America/New_York')).toBe(true); // Monday the 5th
    expect(cronMatches(c, at('2026-10-06T13:00:00Z'), 'America/New_York')).toBe(false);
  });

  it('resolves relative ranges on the run day', () => {
    const d = '2026-09-28'; // Monday; weeks start Monday
    expect(resolveRange('yesterday', d, 1)).toEqual({ from: '2026-09-27', to: '2026-09-27' });
    expect(resolveRange('last_week', d, 1)).toEqual({ from: '2026-09-21', to: '2026-09-27' });
    expect(resolveRange('this_week', d, 1)).toEqual({ from: '2026-09-28', to: '2026-09-28' });
    expect(resolveRange('last_week', d, 0)).toEqual({ from: '2026-09-20', to: '2026-09-26' });
    expect(resolveRange('last_month', d, 1)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(resolveRange('last_month', '2026-03-10', 1)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(resolveRange('this_month', d, 1)).toEqual({ from: '2026-09-01', to: '2026-09-28' });
    expect(resolveRange('last_7_days', d, 1)).toEqual({ from: '2026-09-21', to: '2026-09-27' });
  });
});

describe('authorization matrix document', () => {
  it('docs/security/authorization-matrix.md is up to date (pnpm --filter @tallywork/domain gen:matrix)', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/security/authorization-matrix.md');
    expect(readFileSync(file, 'utf8')).toBe(authorizationMatrixMarkdown());
  });
});
