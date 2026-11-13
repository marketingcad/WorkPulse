import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { APP_ROLE, createDb, withSessionSetup } from '../src/client';

/**
 * QA audit, 11 Nov 2026 (Phase 2): the session setup of a pooled connection (restricted role, time
 * limits) was fired without waiting, from the pool's 'connect' event. If one of those statements
 * failed, an 'error' event no one listened to crashed the instance, and the request's own queries,
 * queued behind it, could run without the restricted role. Now the setup is part of connecting.
 *
 * The first part drives the real pg-pool with a stand-in connection; the second needs PostgreSQL
 * (TEST_DATABASE_URL, set in CI's "Migrations on PostgreSQL" job after migrating).
 */
const SETUP = [`set role ${APP_ROLE}`, 'set statement_timeout = 30000', 'set idle_in_transaction_session_timeout = 120000'];

let log: string[] = [];
let failOn: string | null = null;
let ended = 0;

/** Just enough of pg.Client for pg-pool: connect, query, end, events. */
class FakeConnection extends EventEmitter {
  _queryable = true;
  _ending = false;
  async connect() {
    return this;
  }
  async query(q: string) {
    log.push(q);
    if (q === failOn) throw new Error(`refused: ${q}`);
    return { rows: [] };
  }
  async end() {
    this._ending = true;
    ended++;
    this.emit('end');
  }
}

const poolOf = () => new pg.Pool({ Client: withSessionSetup(FakeConnection, SETUP) as unknown as typeof pg.Client, max: 2 });

afterEach(() => {
  log = [];
  failOn = null;
  ended = 0;
});

describe('pooled connections run their session setup before they are used', () => {
  it('runs the setup, in order, before the connection is handed out', async () => {
    const pool = poolOf();
    const c = await pool.connect();
    expect(log).toEqual(SETUP);
    await c.query('select 1');
    expect(log).toEqual([...SETUP, 'select 1']);
    c.release();
    // A reused connection does not run it again.
    const again = await pool.connect();
    await again.query('select 2');
    expect(log).toEqual([...SETUP, 'select 1', 'select 2']);
    again.release();
    await pool.end();
  });

  it('a failed setup fails the checkout and closes the connection: nothing else runs on it, nothing crashes', async () => {
    failOn = 'set statement_timeout = 30000';
    const pool = poolOf();
    await expect(pool.connect()).rejects.toThrow(/refused: set statement_timeout/);
    expect(log).toEqual(SETUP.slice(0, 2)); // the rest of the setup never ran, and no request query did
    expect(ended).toBe(1);
    expect(pool.totalCount).toBe(0);

    // The next checkout gets a fresh, fully set-up connection.
    failOn = null;
    log = [];
    const c = await pool.connect();
    expect(log).toEqual(SETUP);
    c.release();
    await pool.end();
  });

  it('a failed role switch fails the checkout too (the request never runs as the owner)', async () => {
    failOn = `set role ${APP_ROLE}`;
    const pool = poolOf();
    await expect(pool.connect()).rejects.toThrow(/refused: set role/);
    expect(log).toEqual([`set role ${APP_ROLE}`]);
    await pool.end();
  });

  it('connect() without a callback resolves after the setup', async () => {
    const C = withSessionSetup(FakeConnection, SETUP);
    await new C().connect();
    expect(log).toEqual(SETUP);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('on PostgreSQL', () => {
  it('every pooled connection runs as the restricted role, with the time limits', async () => {
    const h = createDb(process.env.TEST_DATABASE_URL!);
    try {
      // Several at once, so the pool opens several connections.
      const rows = await Promise.all(Array.from({ length: 5 }, () => h.db.execute(sql`select current_user as role, current_setting('statement_timeout') as timeout, pg_sleep(0.05)`)));
      for (const r of rows) expect((r as unknown as { rows: Array<{ role: string; timeout: string }> }).rows[0]).toMatchObject({ role: APP_ROLE, timeout: '30s' });
      expect(h.pool!.totalCount).toBeGreaterThan(1);
    } finally {
      await h.close();
    }
  });
});
