import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { newId } from '@tallywork/domain';
import { createDb, type DbHandle } from '../src/client';
import { organizations, withSystem, withTenant } from '../src/index';

/**
 * Indexes added by the Phase 14 index review (docs/ops/performance-review-2026-11.md). Two
 * organizations of a realistic size share each table, as in production, and the planner has
 * statistics (ANALYZE); each hot statement must then use its index instead of reading the table.
 */
let h: DbHandle;
const orgA = newId();
const orgB = newId();
const settings = { lateGraceMinutes: 5, durationFormat: 'hm' as const, budgetWarnPct: 80, requireDeviceApproval: false, enforceMfa: 'none' as const, sessionTtlHours: 336 };

interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}
const indexesIn = (n: PlanNode): string[] => [...(n['Index Name'] ? [n['Index Name']] : []), ...(n.Plans ?? []).flatMap(indexesIn)];
const seqScans = (n: PlanNode): number => (n['Node Type'] === 'Seq Scan' ? 1 : 0) + (n.Plans ?? []).reduce((s, p) => s + seqScans(p), 0);

async function plan(org: string, statement: ReturnType<typeof sql>): Promise<PlanNode> {
  const r = (await withTenant(h.db, org, (tx) => tx.execute(sql`explain (format json) ${statement}`))) as unknown as { rows: Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }> };
  return r.rows[0]!['QUERY PLAN'][0]!.Plan;
}

/** 40 members, 40 projects with 10 tasks each, and ~400 days of history per organization. */
async function seed(org: string, slug: string) {
  await withSystem(h.db, async (tx) => {
    const x = (q: ReturnType<typeof sql>) => tx.execute(q);
    await tx.insert(organizations).values({ id: org, slug, name: slug, settings });
    const role = newId();
    await x(sql`insert into roles (id, organization_id, key, name) values (${role}::uuid, ${org}::uuid, 'WORKER', 'Worker')`);
    await x(sql`insert into users (id, email, name, password_hash) select gen_random_uuid(), ${slug} || g || '@idx.test', 'U' || g, 'x' from generate_series(1, 40) g`);
    await x(sql`insert into memberships (id, organization_id, user_id, role_id) select gen_random_uuid(), ${org}::uuid, id, ${role}::uuid from users where email like ${`${slug}%@idx.test`}`);
    await x(sql`insert into projects (id, organization_id, name) select gen_random_uuid(), ${org}::uuid, 'P' || g from generate_series(1, 40) g`);
    await x(sql`insert into tasks (id, organization_id, project_id, title) select gen_random_uuid(), ${org}::uuid, p.id, 'T' || g from projects p cross join generate_series(1, 10) g where p.organization_id = ${org}::uuid`);
    await x(sql`create temp table idx_m on commit drop as select id, row_number() over (order by id) as rn from memberships where organization_id = ${org}::uuid`);
    await x(sql`create temp table idx_t on commit drop as select t.id, t.project_id, row_number() over (order by t.id) as rn from tasks t where t.organization_id = ${org}::uuid`);
    await x(sql`create temp table idx_s on commit drop as
      select gen_random_uuid() as id, m.id as membership_id, t.project_id, t.id as task_id, now() - make_interval(days => d) as started_at
      from idx_m m join idx_t t on t.rn = m.rn * 10 cross join generate_series(1, 400) d`);
    await x(sql`insert into tracking_sessions (id, organization_id, membership_id, source, project_id, state, started_at, ended_at, timezone)
      select id, ${org}::uuid, membership_id, 'DESKTOP', project_id, 'STOPPED', started_at, started_at + interval '1 hour', 'UTC' from idx_s`);
    await x(sql`insert into time_entries (id, organization_id, membership_id, project_id, task_id, session_id, source, started_at, ended_at, duration_seconds, local_date, timezone, billable)
      select gen_random_uuid(), ${org}::uuid, membership_id, project_id, task_id, id, 'TRACKED', started_at, started_at + interval '1 hour', 3600, to_char(started_at, 'YYYY-MM-DD'), 'UTC', true from idx_s`);
    await x(sql`insert into rollup_worker_day (organization_id, membership_id, local_date, project_id, task_key, billable, tracked_seconds)
      select ${org}::uuid, membership_id, to_char(started_at, 'YYYY-MM-DD'), project_id, '', true, 3600 from idx_s`);
  });
}

beforeAll(async () => {
  h = createDb('pglite://memory');
  await h.migrate();
  await seed(orgA, 'idxa');
  await seed(orgB, 'idxb');
  // Planner statistics, as production has them (as the owner: the app role cannot ANALYZE).
  for (const stmt of ['reset role', 'analyze', 'set role tallywork_app']) await h.db.execute(sql.raw(stmt));
}, 120_000);

afterAll(() => h.close());

const someIds = async (table: 'projects' | 'tasks', n: number) =>
  ((await withTenant(h.db, orgA, (tx) => tx.execute(sql`select id from ${sql.identifier(table)} order by id limit ${n}`))) as unknown as { rows: Array<{ id: string }> }).rows.map((r) => r.id);

describe('hot-read indexes', () => {
  it('exist', async () => {
    const r = (await h.db.execute(sql`select indexname from pg_indexes where schemaname = 'public'`)) as unknown as { rows: Array<{ indexname: string }> };
    const names = new Set(r.rows.map((x) => x.indexname));
    for (const i of ['rollup_worker_day_org_project_idx', 'time_entries_org_task_idx', 'tracking_sessions_org_ended_idx']) expect(names, i).toContain(i);
  });

  it('projects list: hours per project use rollup_worker_day_org_project_idx', async () => {
    const ids = await someIds('projects', 3);
    const p = await plan(orgA, sql`select project_id, sum(tracked_seconds) from rollup_worker_day where organization_id = ${orgA}::uuid and project_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) group by project_id`);
    expect(indexesIn(p)).toContain('rollup_worker_day_org_project_idx');
    expect(seqScans(p)).toBe(0);
  });

  it('time per task uses time_entries_org_task_idx', async () => {
    const ids = await someIds('tasks', 10);
    const p = await plan(orgA, sql`select task_id, sum(duration_seconds) from time_entries where organization_id = ${orgA}::uuid and task_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) and deleted_at is null group by task_id`);
    expect(indexesIn(p)).toContain('time_entries_org_task_idx');
    expect(seqScans(p)).toBe(0);
  });

  it('sessions in the last 7 days use tracking_sessions_org_ended_idx', async () => {
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const to = new Date().toISOString();
    const p = await plan(
      orgA,
      sql`select id from tracking_sessions where organization_id = ${orgA}::uuid and started_at < ${to}::timestamptz and coalesce(ended_at, now()) >= ${from}::timestamptz and (ended_at >= ${from}::timestamptz or ended_at is null) order by started_at desc limit 50`,
    );
    expect(indexesIn(p)).toContain('tracking_sessions_org_ended_idx');
    expect(seqScans(p)).toBe(0);
  });
});
