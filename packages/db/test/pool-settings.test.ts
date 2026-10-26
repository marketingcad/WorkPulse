import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { APP_ROLE, createDb, poolSettings, sessionSetupSql, type DbHandle } from '../src/client';

describe('pool settings', () => {
  it('defaults: 10 connections, 10 s to get one, 30 s per statement, 2 min idle in a transaction', () => {
    expect(poolSettings({})).toEqual({ max: 10, connectionTimeoutMillis: 10_000, statementTimeoutMs: 30_000, idleInTransactionTimeoutMs: 120_000 });
  });

  it('reads overrides from the environment', () => {
    expect(poolSettings({ DB_POOL_MAX: '4', DB_CONNECT_TIMEOUT_MS: '5000', DB_STATEMENT_TIMEOUT_MS: '60000', DB_IDLE_IN_TX_TIMEOUT_MS: '300000' })).toEqual({
      max: 4,
      connectionTimeoutMillis: 5000,
      statementTimeoutMs: 60_000,
      idleInTransactionTimeoutMs: 300_000,
    });
  });

  it('ignores values that are not positive whole numbers, so a typo cannot remove a limit', () => {
    const s = poolSettings({ DB_POOL_MAX: '0', DB_CONNECT_TIMEOUT_MS: 'abc', DB_STATEMENT_TIMEOUT_MS: '-1', DB_IDLE_IN_TX_TIMEOUT_MS: '1.5' });
    expect(s).toEqual(poolSettings({}));
  });
});

describe('connection setup', () => {
  let h: DbHandle;
  beforeAll(async () => {
    h = createDb('pglite://memory');
    await h.migrate();
  }, 60_000);
  afterAll(() => h.close());

  it('switches to the restricted role and applies the time limits on real Postgres', async () => {
    await h.db.execute(sql.raw('reset role'));
    for (const q of sessionSetupSql(poolSettings({}))) await h.db.execute(sql.raw(q));
    const res = await h.db.execute(sql`select current_user as u, current_setting('statement_timeout') as st, current_setting('idle_in_transaction_session_timeout') as idle`);
    const [who] = (res as unknown as { rows: Array<{ u: string; st: string; idle: string }> }).rows;
    expect(who).toEqual({ u: APP_ROLE, st: '30s', idle: '2min' });
  });
  // PGlite is single-threaded and does not enforce statement_timeout, so cancellation itself (57014)
  // is covered against the error mapping in packages/api/test/tick-lease.test.ts, not here.
});
