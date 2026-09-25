import { and, eq, inArray, sql } from 'drizzle-orm';
import { rollupAppDay, rollupWorkerDay, type Tx } from '@tallywork/db';

/**
 * Rebuild the daily rollups for one worker on the given local dates from the
 * canonical tables. Idempotent: safe to run for late/offline/edited data.
 */
export async function recomputeWorkerDays(tx: Tx, organizationId: string, membershipId: string, dates: string[]): Promise<void> {
  if (!dates.length) return;
  await tx.delete(rollupWorkerDay).where(and(eq(rollupWorkerDay.membershipId, membershipId), inArray(rollupWorkerDay.localDate, dates)));
  await tx.execute(sql`
    insert into rollup_worker_day (organization_id, membership_id, local_date, project_id, task_key, billable, tracked_seconds, manual_seconds)
    select organization_id, membership_id, local_date, project_id, coalesce(task_id::text, ''), billable,
           coalesce(sum(duration_seconds) filter (where source = 'TRACKED'), 0)::int,
           coalesce(sum(duration_seconds) filter (where source = 'MANUAL'), 0)::int
      from time_entries
     where membership_id = ${membershipId} and deleted_at is null and local_date in ${sql.raw(`(${dates.map((d) => `'${d.replace(/[^0-9-]/g, '')}'`).join(',')})`)}
     group by organization_id, membership_id, local_date, project_id, coalesce(task_id::text, ''), billable
  `);
  // Activity windows are per project/task, but a day can have a billable and a non-billable row
  // for the same task: put the activity on one row (the larger one) so it is never counted twice.
  await tx.execute(sql`
    update rollup_worker_day r
       set active_seconds = a.active, activity_tracked_seconds = a.tracked, updated_at = now()
      from (
        select local_date, project_id, coalesce(task_id::text, '') as task_key, sum(active_seconds)::int as active, sum(tracked_seconds)::int as tracked
          from activity_windows
         where membership_id = ${membershipId} and local_date in ${sql.raw(`(${dates.map((d) => `'${d.replace(/[^0-9-]/g, '')}'`).join(',')})`)}
         group by 1, 2, 3
      ) a,
      (
        select distinct on (local_date, project_id, task_key) local_date, project_id, task_key, billable
          from rollup_worker_day
         where membership_id = ${membershipId} and local_date in ${sql.raw(`(${dates.map((d) => `'${d.replace(/[^0-9-]/g, '')}'`).join(',')})`)}
         order by local_date, project_id, task_key, tracked_seconds + manual_seconds desc, billable desc
      ) t
     where r.membership_id = ${membershipId} and r.local_date = a.local_date and r.project_id = a.project_id and r.task_key = a.task_key
       and t.local_date = r.local_date and t.project_id = r.project_id and t.task_key = r.task_key and t.billable = r.billable
  `);
  void organizationId;
}

export async function recomputeUsageDays(tx: Tx, membershipId: string, dates: string[]): Promise<void> {
  if (!dates.length) return;
  const list = sql.raw(`(${dates.map((d) => `'${d.replace(/[^0-9-]/g, '')}'`).join(',')})`);
  await tx.delete(rollupAppDay).where(and(eq(rollupAppDay.membershipId, membershipId), inArray(rollupAppDay.localDate, dates)));
  await tx.execute(sql`
    insert into rollup_app_day (organization_id, membership_id, local_date, kind, name, project_id, seconds)
    select a.organization_id, a.membership_id, to_char(a.started_at at time zone s.timezone, 'YYYY-MM-DD') as d, 'APP', a.app_name, s.project_id, sum(a.duration_seconds)
      from app_spans a join tracking_sessions s on s.id = a.session_id
     where a.membership_id = ${membershipId} and to_char(a.started_at at time zone s.timezone, 'YYYY-MM-DD') in ${list}
     group by 1, 2, 3, 4, 5, 6
    union all
    select u.organization_id, u.membership_id, to_char(u.started_at at time zone s.timezone, 'YYYY-MM-DD') as d, 'URL', u.domain, s.project_id, sum(u.duration_seconds)
      from url_spans u join tracking_sessions s on s.id = u.session_id
     where u.membership_id = ${membershipId} and to_char(u.started_at at time zone s.timezone, 'YYYY-MM-DD') in ${list}
     group by 1, 2, 3, 4, 5, 6
  `);
}

/**
 * Nightly reconciliation: compare each worker-day's rollup total with the time entries it is
 * built from, and rebuild the days that drifted. Returns how many worker-days were checked and
 * rebuilt (the drift metric).
 */
export async function reconcileWorkerDays(tx: Tx, organizationId: string, from: string, to: string): Promise<{ checked: number; drifted: number }> {
  const res = await tx.execute<{ membership_id: string; local_date: string; source: number; rollup: number }>(sql`
    with src as (
      select membership_id, local_date, sum(duration_seconds)::bigint as s
        from time_entries where deleted_at is null and local_date between ${from} and ${to}
       group by 1, 2
    ), agg as (
      select membership_id, local_date, sum(tracked_seconds + manual_seconds)::bigint as s
        from rollup_worker_day where local_date between ${from} and ${to}
       group by 1, 2
    )
    select coalesce(src.membership_id, agg.membership_id) as membership_id, coalesce(src.local_date, agg.local_date) as local_date,
           coalesce(src.s, 0)::bigint as source, coalesce(agg.s, 0)::bigint as rollup
      from src full outer join agg on agg.membership_id = src.membership_id and agg.local_date = src.local_date
  `);
  const rows = (res as unknown as { rows: Array<{ membership_id: string; local_date: string; source: number; rollup: number }> }).rows;
  const drifted = rows.filter((r) => Number(r.source) !== Number(r.rollup));
  const byWorker = new Map<string, string[]>();
  for (const r of drifted) byWorker.set(r.membership_id, [...(byWorker.get(r.membership_id) ?? []), r.local_date]);
  for (const [m, dates] of byWorker) await recomputeWorkerDays(tx, organizationId, m, dates);
  return { checked: rows.length, drifted: drifted.length };
}
