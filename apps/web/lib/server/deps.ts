import 'server-only';
import path from 'node:path';
import { after } from 'next/server';
import { attachDatabasePool } from '@vercel/functions';
import { createApp, createMailer, createStorage, loadConfig, type App, type Deps } from '@tallywork/api';
import { createDb } from '@tallywork/db/client';

/**
 * One set of infrastructure per server instance (Fluid Compute reuses instances).
 * - Production (Vercel): Neon via DATABASE_URL, Vercel Blob via BLOB_READ_WRITE_TOKEN.
 * - Local dev with no env: file-backed PGlite + local file storage, auto-migrated.
 */
let appPromise: Promise<{ app: App; deps: Deps }> | null = null;

function localDataDir(): string {
  return path.resolve(process.cwd(), '.data');
}

async function init() {
  if (process.env.VERCEL && !process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    throw new Error('DATABASE_URL is not configured. Connect a Neon database from the Vercel Marketplace and redeploy.');
  }
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? `pglite://${localDataDir().replaceAll('\\', '/')}/pglite`;
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.LOCAL_STORAGE_DIR) process.env.LOCAL_STORAGE_DIR = `${localDataDir()}/blobs`;
  const handle = createDb(url);
  if (handle.pool) attachDatabasePool(handle.pool);
  // Local PGlite is migrated on boot; Neon is migrated during the Vercel build.
  if (handle.kind === 'pglite') await handle.migrate();
  const deps: Deps = {
    db: handle.db,
    config: loadConfig(),
    storage: createStorage(),
    mailer: createMailer(),
    defer: (task) => after(task),
    now: () => new Date(),
  };
  return { app: createApp(deps), deps };
}

export function getApi() {
  appPromise ??= init().catch((e) => {
    appPromise = null;
    throw e;
  });
  return appPromise;
}
