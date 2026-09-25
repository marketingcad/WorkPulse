import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Real env vars win; then packages/db/.env; then the web app's env files (single source of truth).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
config({ path: [path.join(root, 'packages/db/.env'), path.join(root, 'apps/web/.env.local'), path.join(root, 'apps/web/.env')], quiet: true });
import { createDb } from '../src/client';

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) {
  if (process.env.VERCEL) {
    console.warn('⚠ DATABASE_URL is not set — skipping migrations. Set it to the Supabase Session pooler URL and redeploy.');
    process.exit(0);
  }
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
// Poolers can drop a connection now and then; retry those (migrations are safe to re-run).
// SQL errors are not retried: they fail the deploy straight away.
const transient = (e: unknown) => /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|Connection terminated|connection.*(closed|terminated)|timeout/i.test(e instanceof Error ? `${e.message} ${(e as { code?: string }).code ?? ''}` : String(e));
for (let attempt = 1; ; attempt++) {
  const h = createDb(url, { runAsAppRole: false });
  try {
    await h.migrate();
    console.log(`migrations + RLS applied (${h.kind})`);
    break;
  } catch (e) {
    if (attempt >= 3 || !transient(e)) throw e;
    console.warn(`migration attempt ${attempt} lost its connection (${e instanceof Error ? e.message : e}); retrying`);
    await new Promise((r) => setTimeout(r, attempt * 2000));
  } finally {
    await h.close().catch(() => undefined);
  }
}
