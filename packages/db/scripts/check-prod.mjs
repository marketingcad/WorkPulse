// Read-only check of the production database (DATABASE_URL in the repo's root .env): whether
// migrations 0028 and 0029 have been applied. Runs inside a READ ONLY transaction; writes nothing.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const env = readFileSync(new URL('../../../.env', import.meta.url), 'utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!url) throw new Error('No DATABASE_URL in the root .env');
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin transaction read only');
  const one = async (q) => (await client.query(q)).rows;
  const [{ n: recorded }] = await one('select count(*)::int as n from drizzle.__drizzle_migrations');
  const [last] = await one('select created_at from drizzle.__drizzle_migrations order by created_at desc limit 1');
  const [{ n: table }] = await one("select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'refused_time'");
  const cols = (await one("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'expenses' and column_name in ('rejection_reason', 'rejected_by', 'rejected_at') order by 1")).map((r) => r.column_name);
  const [rls] = await one("select relrowsecurity as on, relforcerowsecurity as forced from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relname = 'refused_time'");
  console.log(`migrations recorded: ${recorded}, latest created_at: ${last ? new Date(Number(last.created_at)).toISOString() : '(none)'}`);
  console.log(`0028 refused_time table: ${table === 1 ? 'present' : 'MISSING'}${rls ? ` (row-level security ${rls.on ? 'on' : 'OFF'}, ${rls.forced ? 'forced' : 'NOT forced'})` : ''}`);
  console.log(`0029 expense columns: ${cols.length === 3 ? 'present' : `MISSING (${cols.join(', ') || 'none'})`}`);
  await client.query('rollback');
} finally {
  await client.end();
}
