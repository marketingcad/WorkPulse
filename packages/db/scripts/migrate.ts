import 'dotenv/config';
import { createDb } from '../src/client';

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const h = createDb(url, { runAsAppRole: false });
await h.migrate();
await h.close();
console.log(`migrations + RLS applied (${h.kind})`);
