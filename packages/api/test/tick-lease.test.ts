import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimTick, minuteGate, releaseTick, runTickOnce } from '../src/app';
import { isDatabaseBusy, problemFromError } from '../src/lib/http';
import { createHarness, type Harness } from './harness';

let t: Harness;
beforeAll(async () => {
  t = await createHarness();
  t.clock.set(new Date('2026-10-26T09:00:10Z'));
}, 60_000);
afterAll(() => t.close());

const cron = () => t.app.request('/api/v1/cron/tick', { headers: { Authorization: 'Bearer cron-secret' } });

describe('minute tick lease', () => {
  it('one run per minute across instances, and never two at once', async () => {
    const first = await claimTick(t.deps);
    expect(first).toBeInstanceOf(Date);
    // Another instance in the same minute, while the first is still running.
    expect(await claimTick(t.deps)).toBeNull();
    // Still running in the next minute (a slow tick): no overlapping run.
    t.clock.set(new Date('2026-10-26T09:01:05Z'));
    expect(await claimTick(t.deps)).toBeNull();
    await releaseTick(t.deps, first!);
    // Finished: the next minute may run once.
    const second = await claimTick(t.deps);
    expect(second).toBeInstanceOf(Date);
    await releaseTick(t.deps, second!);
    // Same minute again after it finished: skipped.
    t.clock.set(new Date('2026-10-26T09:01:50Z'));
    expect(await claimTick(t.deps)).toBeNull();
  });

  it('takes over a run that crashed (older than the function limit) without being released', async () => {
    t.clock.set(new Date('2026-10-26T09:10:00Z'));
    const crashed = await claimTick(t.deps);
    expect(crashed).toBeInstanceOf(Date);
    t.clock.set(new Date('2026-10-26T09:14:00Z'));
    expect(await claimTick(t.deps)).toBeNull(); // 4 minutes: may still be running
    t.clock.set(new Date('2026-10-26T09:16:30Z'));
    const takeover = await claimTick(t.deps);
    expect(takeover).toBeInstanceOf(Date);
    // The crashed run's late release must not free the new run's lease.
    await releaseTick(t.deps, crashed!);
    expect(await claimTick(t.deps)).toBeNull();
    await releaseTick(t.deps, takeover!);
  });

  it('Vercel Cron runs the tick once a minute and reports a skip otherwise', async () => {
    t.clock.set(new Date('2026-10-26T10:00:05Z'));
    const r1 = await cron();
    expect(r1.status).toBe(200);
    expect(await r1.json()).toHaveProperty('sessions');
    const r2 = await cron();
    expect([r2.status, await r2.json()]).toEqual([200, { skipped: true }]);
    t.clock.set(new Date('2026-10-26T10:01:00Z'));
    expect(await runTickOnce(t.deps)).not.toBeNull();
  });

  it('releases the lease when the tick fails, so the next minute can run', async () => {
    t.clock.set(new Date('2026-10-26T11:00:00Z'));
    // The claim reads the clock once; the run's first read of the clock then fails.
    let calls = 0;
    const failing = {
      ...t.deps,
      now: () => {
        calls++;
        if (calls > 1) throw new Error('boom');
        return t.clock.now;
      },
    };
    await expect(runTickOnce(failing as never)).rejects.toThrow();
    t.clock.set(new Date('2026-10-26T11:01:00Z'));
    expect(await claimTick(t.deps)).toBeInstanceOf(Date);
  });
});

describe('opportunistic tick gate', () => {
  it('lets an instance try once per minute, not on every request', () => {
    const gate = minuteGate();
    expect(gate(new Date('2026-10-26T09:00:01Z'))).toBe(true);
    expect(gate(new Date('2026-10-26T09:00:59Z'))).toBe(false);
    expect(gate(new Date('2026-10-26T09:01:00Z'))).toBe(true);
  });
});

describe('database overload', () => {
  it('a full pool or a statement timeout is a 503 the client can retry, other errors stay 500', () => {
    const poolTimeout = new Error('timeout exceeded when trying to connect');
    const statementTimeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    const wrapped = Object.assign(new Error('Failed query'), { cause: statementTimeout });
    for (const e of [poolTimeout, statementTimeout, wrapped]) {
      expect(isDatabaseBusy(e)).toBe(true);
      expect(problemFromError(e, 'r1')).toMatchObject({ status: 503, code: 'service_busy' });
    }
    expect(problemFromError(new Error('something else'), 'r1')).toMatchObject({ status: 500, code: 'internal_error' });
  });
});
