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
  await tx.execute(sql`
    update rollup_worker_day r
       set active_seconds = a.active, activity_tracked_seconds = a.tracked, updated_at = now()
      from (
        select local_date, project_id, coalesce(task_id::text, '') as task_key, sum(active_seconds)::int as active, sum(tracked_seconds)::int as tracked
          from activity_windows
         where membership_id = ${membershipId} and local_date in ${sql.raw(`(${dates.map((d) => `'${d.replace(/[^0-9-]/g, '')}'`).join(',')})`)}
         group by 1, 2, 3
      ) a
     where r.membership_id = ${membershipId} and r.local_date = a.local_date and r.project_id = a.project_id and r.task_key = a.task_key
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
