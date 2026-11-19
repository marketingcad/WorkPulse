/**
 * Index review (Phase 14): `pnpm perf:index-review`.
 *
 * Seeds an organization at scale 10 (200 members, 60 days of history) in an in-memory database, runs
 * every hot read once (test/support/hot-reads.ts), captures each SQL statement they send, and runs
 * EXPLAIN on it as the app role inside that organization's tenant context (so row-level security is in
 * the plan, as in production). It prints every sequential scan of a table holding more than 10,000
 * rows, with the reads that caused it. A second organization of the same size shares the tables, as in
 * production: a query that leaves the tenant filter to RLS alone then shows up as a scan of both.
 * Test support only: nothing here runs in production.
 */
import { writeFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { createHarness, signup } from '../test/harness';
import { seedBigOrg } from '../test/support/big-org';
import { hotReads, setupHotOrg } from '../test/support/hot-reads';

const LARGE = 10_000;
const SCALE = Number(process.env.SCALE ?? 10);

interface Captured {
  sql: string;
  params: unknown[];
  reads: Set<string>;
}

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  Filter?: string;
  'Plan Rows'?: number;
  Plans?: PlanNode[];
}

const t = await createHarness();
console.log(`Seeding an organization at scale ${SCALE}…`);
const org = await setupHotOrg(t, SCALE, `review${SCALE}`);
const neighbor = await signup(t, 'Nia', `neighbor${SCALE}@perf.test`);
await seedBigOrg(t, neighbor.orgId, SCALE);
const client = (t.h.db as unknown as { $client: PGlite }).$client;

// Planner statistics, as a production database would have them (as the owner; the app role cannot).
await client.exec('reset role; analyze; set role tallywork_app');
const rows = await client.query<{ relname: string; n: number }>(`select relname, reltuples::bigint as n from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace`);
const tableRows = new Map(rows.rows.map((r) => [r.relname, Number(r.n)]));

// Capture what each read sends: wrap query on the client and on every transaction it opens.
const statements = new Map<string, Captured>();
let current: string | null = null;
const capture = (target: { query: (...a: unknown[]) => unknown }) => {
  const original = target.query.bind(target);
  target.query = (...args: unknown[]) => {
    const [text, params] = args as [string, unknown[] | undefined];
    if (current && typeof text === 'string' && /^\s*(select|with)\b/i.test(text)) {
      const c = statements.get(text) ?? { sql: text, params: params ?? [], reads: new Set<string>() };
      c.reads.add(current);
      statements.set(text, c);
    }
    return original(...args);
  };
};
capture(client as never);
const transaction = client.transaction.bind(client);
client.transaction = ((fn: (tx: never) => Promise<unknown>) =>
  transaction((tx) => {
    capture(tx as never);
    return fn(tx as never);
  })) as PGlite['transaction'];

const { runHotRead } = await import('../test/support/hot-reads');
for (const r of hotReads(t)) {
  current = r.name;
  const res = await runHotRead(org, r);
  if (res.status !== 200) console.warn(`  ${r.name}: HTTP ${res.status}`);
}
current = null;
client.transaction = transaction as PGlite['transaction'];

function seqScans(node: PlanNode, out: PlanNode[] = []): PlanNode[] {
  if (node['Node Type'] === 'Seq Scan' && node['Relation Name']) out.push(node);
  for (const p of node.Plans ?? []) seqScans(p, out);
  return out;
}

const findings: string[] = [];
let explained = 0;
for (const s of statements.values()) {
  let plan: PlanNode;
  try {
    plan = await transaction(async (tx) => {
      await tx.query(`select set_config('app.org_id', $1, true), set_config('app.bypass_rls', 'off', true)`, [org.orgId]);
      const r = await tx.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>(`explain (format json) ${s.sql}`, s.params);
      return r.rows[0]!['QUERY PLAN'][0]!.Plan;
    });
  } catch (e) {
    findings.push(`! could not EXPLAIN (${(e as Error).message.slice(0, 80)}): ${s.sql.slice(0, 120)}`);
    continue;
  }
  explained++;
  for (const n of seqScans(plan)) {
    const table = n['Relation Name']!;
    const size = tableRows.get(table) ?? 0;
    if (size <= LARGE) continue;
    findings.push(
      [`Seq Scan on ${table} (${size.toLocaleString('en-US')} rows)`, `  reads:  ${[...s.reads].join('; ')}`, `  filter: ${n.Filter ?? '(none)'}`, `  sql:    ${s.sql.replace(/\s+/g, ' ').slice(0, 400)}`].join('\n'),
    );
  }
}

const large = [...tableRows].filter(([, n]) => n > LARGE).sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} ${n.toLocaleString('en-US')}`);
const report = [
  `Index review at scale ${SCALE} (two organizations of that size): ${statements.size} distinct SELECT statements from ${hotReads(t).length} hot reads, ${explained} explained.`,
  `Tables over ${LARGE.toLocaleString('en-US')} rows: ${large.join(', ')}`,
  '',
  findings.length ? findings.join('\n\n') : 'No sequential scans on large tables.',
].join('\n');
console.log(`\n${report}\n`);
if (process.env.REVIEW_REPORT) writeFileSync(process.env.REVIEW_REPORT, `${report}\n`);
await t.close();
