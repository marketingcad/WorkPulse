import 'dotenv/config';
import { createDb } from '../src/client';

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) {
  if (process.env.VERCEL) {
    console.warn('⚠ DATABASE_URL is not set — skipping migrations. Connect Neon (Vercel Marketplace) and redeploy.');
    process.exit(0);
  }
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const h = createDb(url, { runAsAppRole: false });
await h.migrate();
await h.close();
console.log(`migrations + RLS applied (${h.kind})`);
