import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { notifications, outboxEvents, withSystem, withTenant } from '@tallywork/db';
import { addMember, createHarness, signup, type Client, type Harness } from './harness';
import { emit } from '../src/services/events';
import { runDaily } from '../src/jobs';

/**
 * A failure in the Performance Center never holds up the rest of the system: an event's notifications
 * and webhooks still go out (the performance step is retried on its own), and the daily job's
 * retention, accruals and overdue invoices still commit.
 */
const fail = vi.hoisted(() => ({ event: false, daily: false, calls: [] as string[] }));
vi.mock('../src/services/performance-jobs', async (original) => {
  const real = await original<typeof import('../src/services/performance-jobs')>();
  return {
    ...real,
    handlePerformanceEvent: async (...args: Parameters<typeof real.handlePerformanceEvent>) => {
      fail.calls.push(args[2].event_id);
      if (fail.event) throw new Error('performance step broke');
      return real.handlePerformanceEvent(...args);
    },
    performanceDaily: async (...args: Parameters<typeof real.performanceDaily>) => {
      if (fail.daily) throw new Error('daily performance broke');
      return real.performanceDaily(...args);
    },
  };
});

let t: Harness;
let admin: Client;
let orgId: string;
let workerId: string;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-11-12T14:00:00Z'));
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@pji.test'));
  ({ membershipId: workerId } = await addMember(t, admin, orgId, 'Zara', 'zara@pji.test'));
  await t.flush();
}, 90_000);
afterAll(() => t.close());

const pending = (type: string) => withSystem(t.h.db, (tx) => tx.select().from(outboxEvents).where(and(eq(outboxEvents.eventType, type), isNull(outboxEvents.processedAt))));

describe('outbox events', () => {
  it('a failing performance step does not stop the event’s notification; it is retried on its own', async () => {
    fail.event = true;
    fail.calls.length = 0;
    const eventId = await withTenant(t.h.db, orgId, (tx) => emit(tx, orgId, 'timesheet.approved', { membership_id: workerId, period_start: '2026-11-01', period_end: '2026-11-15' }));
    await t.flush();

    // The event itself is done, and the worker was told.
    const [original] = await withSystem(t.h.db, (tx) => tx.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)));
    expect(original!.processedAt).not.toBeNull();
    const told = await withTenant(t.h.db, orgId, (tx) => tx.select().from(notifications).where(and(eq(notifications.membershipId, workerId), eq(notifications.type, 'timesheet.approved'))));
    expect(told).toHaveLength(1);

    // The performance step is queued separately, and while it keeps failing only it is retried.
    expect(await pending('performance.retry')).toHaveLength(1);
    await t.flush();
    const [retry] = await pending('performance.retry');
    expect(retry!.attempts).toBe(1);
    expect(retry!.lastError).toBe('performance step broke');

    // Once it works, the retry runs it with the original event, and nobody is notified twice.
    fail.event = false;
    fail.calls.length = 0;
    await t.flush();
    expect(fail.calls).toEqual([eventId]);
    expect(await pending('performance.retry')).toHaveLength(0);
    const toldAgain = await withTenant(t.h.db, orgId, (tx) => tx.select().from(notifications).where(and(eq(notifications.membershipId, workerId), eq(notifications.type, 'timesheet.approved'))));
    expect(toldAgain).toHaveLength(1);
  });
});

describe('daily job', () => {
  it('a failing performance step leaves the rest of the organization’s daily work committed', async () => {
    fail.daily = true;
    // An old processed event that the daily cleanup deletes (14 days after it was processed).
    const oldId = await withTenant(t.h.db, orgId, (tx) => emit(tx, orgId, 'device.offline', { name: 'Old laptop' }));
    await withSystem(t.h.db, (tx) => tx.update(outboxEvents).set({ processedAt: new Date('2026-10-01T00:00:00Z') }).where(eq(outboxEvents.id, oldId)));

    const summary = (await runDaily(t.deps)) as Record<string, { performance: { error?: string }; accrued: unknown }>;
    expect(summary[orgId]!.performance.error).toBe('daily performance broke');
    expect(summary[orgId]!.accrued).toBeDefined();
    const cleaned = await withSystem(t.h.db, (tx) => tx.select().from(outboxEvents).where(eq(outboxEvents.id, oldId)));
    expect(cleaned).toHaveLength(0);

    fail.daily = false;
    const ok = (await runDaily(t.deps)) as Record<string, { performance: { error?: string; members?: number } }>;
    expect(ok[orgId]!.performance.error).toBeUndefined();
    expect(ok[orgId]!.performance.members).toBeGreaterThan(0);
  });
});
