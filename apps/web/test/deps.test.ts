import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `next dev` re-runs server modules on hot reload. Each run must reuse the database that is already
 * open: a second PGlite on the same folder while the first is alive corrupted local data.
 */
const createDb = vi.fn(() => ({ kind: 'pglite' as const, db: {}, migrate: vi.fn(async () => undefined), close: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@vercel/functions', () => ({ attachDatabasePool: vi.fn() }));
vi.mock('@tallywork/db/client', () => ({ createDb }));
vi.mock('@tallywork/api', () => ({
  createApp: vi.fn(() => ({ fetch: vi.fn() })),
  createMailer: vi.fn(),
  createStorage: vi.fn(),
  loadConfig: vi.fn(() => ({})),
}));

afterEach(() => {
  delete (globalThis as { __tallyworkDb?: unknown }).__tallyworkDb;
  createDb.mockClear();
});

describe('local database across hot reloads', () => {
  it('opens and migrates the database once, however often the module is reloaded', async () => {
    const first = await (await import('../lib/server/deps')).getApi();
    vi.resetModules(); // what a hot reload does
    const second = await (await import('../lib/server/deps')).getApi();

    expect(createDb).toHaveBeenCalledOnce();
    expect(second.deps.db).toBe(first.deps.db);
    expect(second.app).not.toBe(first.app); // API code changes still apply after a reload
  });

  it('tries again after a failed open instead of keeping the failure', async () => {
    createDb.mockImplementationOnce(() => {
      throw new Error('Aborted()');
    });
    vi.resetModules();
    const { getApi } = await import('../lib/server/deps');
    await expect(getApi()).rejects.toThrow('Aborted()');
    await expect(getApi()).resolves.toBeDefined();
    expect(createDb).toHaveBeenCalledTimes(2);
  });
});
