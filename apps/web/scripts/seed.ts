/**
 * Seed the demo workspace. Uses the same DATABASE_URL / storage as the app.
 *   pnpm --filter @tallywork/web seed            (local PGlite; stop `next dev` first)
 *   DATABASE_URL=... BLOB_READ_WRITE_TOKEN=... pnpm --filter @tallywork/web seed
 */
import path from 'node:path';
import { createMailer, createStorage, loadConfig, seedDemo, type Deps } from '@tallywork/api';
import { createDb } from '@tallywork/db/client';

const dataDir = path.resolve(process.cwd(), '.data');
const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? `pglite://${dataDir.replaceAll('\\', '/')}/pglite`;
if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.LOCAL_STORAGE_DIR) process.env.LOCAL_STORAGE_DIR = `${dataDir}/blobs`;
const h = createDb(url);
await h.migrate();
const deps: Deps = { db: h.db, config: loadConfig({ ...process.env, NODE_ENV: 'development' }), storage: createStorage(), mailer: createMailer({ NODE_ENV: 'test' }), defer: () => undefined, now: () => new Date() };
const started = Date.now();
const res = await seedDemo(deps, {
  days: Number(process.env.SEED_DAYS ?? 14),
  workers: Number(process.env.SEED_WORKERS ?? 30),
  screenshotDays: Number(process.env.SEED_SCREENSHOT_DAYS ?? 2),
  log: (m) => console.log(`[seed ${Math.round((Date.now() - started) / 1000)}s] ${m}`),
});
console.log(`Demo org ${res.organizationId} ready. Sign in: admin@demo.tallywork.app / demo-password-123`);
await h.close();
