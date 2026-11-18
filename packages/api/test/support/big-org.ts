/**
 * A large organization for performance tests (Phase 14): `20 × scale` members in `scale` teams,
 * `4 × scale` projects with tasks, and 60 days of history per member (sessions, time entries, rollups,
 * 10-minute activity windows, screenshots, weekly timesheets), plus today's shifts and presence.
 *
 * Built with bulk `INSERT … SELECT generate_series` under the system context, not through services,
 * so scale 10 seeds in seconds. The rows are shaped like real ones (same columns, states and local
 * dates) so the endpoints run their normal queries; they are not meant to add up to exact totals.
 */
import { sql } from 'drizzle-orm';
import { withSystem } from '@tallywork/db';
import type { Harness } from '../harness';

export interface BigOrg {
  members: number;
  projects: number;
}

export const BIG_ORG_DAYS = 60;
const TZ = 'America/New_York';

export async function seedBigOrg(t: Harness, orgId: string, scale: number): Promise<BigOrg> {
  const members = 20 * scale;
  const projects = 4 * scale;
  const now = t.clock.now;
  // The whole id: organization ids are time-ordered, so two made together share their first characters.
  const tag = orgId.replace(/-/g, '');
  await withSystem(t.h.db, async (tx) => {
    const exec = (q: ReturnType<typeof sql>) => tx.execute(q);
    // Members (workers) with profiles. Passwords are unusable: tests read as the organization's admin.
    await exec(sql`
      insert into users (id, email, name, password_hash, email_verified_at)
      select gen_random_uuid(), 'big' || g || '-' || ${tag} || '@big.test', 'Member ' || lpad(g::text, 4, '0'), 'x', now()
      from generate_series(1, ${members}) g`);
    await exec(sql`
      insert into memberships (id, organization_id, user_id, role_id, status)
      select gen_random_uuid(), ${orgId}::uuid, u.id, (select id from roles where organization_id = ${orgId}::uuid and key = 'WORKER'), 'ACTIVE'
      from users u where u.email like ${`%-${tag}@big.test`}`);
    await exec(sql`create temp table big_m on commit drop as
      select m.id, (row_number() over (order by u.email))::int - 1 as rn
      from memberships m join users u on u.id = m.user_id
      where m.organization_id = ${orgId}::uuid and u.email like ${`%-${tag}@big.test`}`);
    await exec(sql`insert into worker_profiles (membership_id, organization_id, timezone) select id, ${orgId}::uuid, ${TZ} from big_m`);

    // Teams (one per 20 members) and projects (4 per 20 members, 10 tasks each).
    await exec(sql`create temp table big_t on commit drop as select gen_random_uuid() as id, g - 1 as rn from generate_series(1, ${scale}) g`);
    await exec(sql`insert into teams (id, organization_id, name) select id, ${orgId}::uuid, 'Team ' || (rn + 1) from big_t`);
    await exec(sql`insert into team_members (organization_id, team_id, membership_id) select ${orgId}::uuid, t.id, m.id from big_m m join big_t t on t.rn = m.rn % ${scale}`);
    await exec(sql`create temp table big_p on commit drop as select gen_random_uuid() as id, g - 1 as rn from generate_series(1, ${projects}) g`);
    await exec(sql`insert into projects (id, organization_id, name) select id, ${orgId}::uuid, 'Project ' || lpad((rn + 1)::text, 3, '0') from big_p`);
    await exec(sql`insert into project_members (organization_id, project_id, membership_id)
      select ${orgId}::uuid, p.id, m.id from big_m m join big_p p on p.rn = m.rn % ${projects} or p.rn = (m.rn + 1) % ${projects}`);
    await exec(sql`insert into tasks (id, organization_id, project_id, title, status)
      select gen_random_uuid(), ${orgId}::uuid, p.id, 'Task ' || g, case when g % 3 = 0 then 'DONE' else 'TODO' end
      from big_p p cross join generate_series(1, 10) g`);

    // One stopped one-hour desktop session per member per day, and its time entry.
    await exec(sql`create temp table big_s on commit drop as
      select gen_random_uuid() as id, m.id as membership_id, p.id as project_id,
        date_trunc('day', ${now}::timestamptz) - make_interval(days => d) + interval '14 hours' as started_at
      from big_m m join big_p p on p.rn = m.rn % ${projects} cross join generate_series(1, ${BIG_ORG_DAYS}) d`);
    await exec(sql`insert into tracking_sessions (id, organization_id, membership_id, source, project_id, state, started_at, ended_at, end_reason, timezone)
      select id, ${orgId}::uuid, membership_id, 'DESKTOP', project_id, 'STOPPED', started_at, started_at + interval '1 hour', 'USER', ${TZ} from big_s`);
    await exec(sql`insert into time_entries (id, organization_id, membership_id, project_id, session_id, source, tracking_source, started_at, ended_at, duration_seconds, local_date, timezone, billable)
      select gen_random_uuid(), ${orgId}::uuid, membership_id, project_id, id, 'TRACKED', 'DESKTOP', started_at, started_at + interval '1 hour', 3600,
        to_char((started_at at time zone ${TZ})::date, 'YYYY-MM-DD'), ${TZ}, true from big_s`);
    await exec(sql`insert into rollup_worker_day (organization_id, membership_id, local_date, project_id, task_key, billable, tracked_seconds, active_seconds, activity_tracked_seconds)
      select ${orgId}::uuid, membership_id, to_char((started_at at time zone ${TZ})::date, 'YYYY-MM-DD'), project_id, '', true, 3600, 2700, 3600 from big_s`);

    // Six 10-minute activity windows per session, each with a screenshot.
    await exec(sql`insert into activity_windows (organization_id, membership_id, window_start, session_id, project_id, active_seconds, tracked_seconds, keyboard_count, mouse_count, activity_pct, keyboard_pct, mouse_pct, local_date)
      select ${orgId}::uuid, s.membership_id, s.started_at + make_interval(mins => 10 * k), s.id, s.project_id, 450, 600, 300, 500, 75, 50, 70,
        to_char((s.started_at at time zone ${TZ})::date, 'YYYY-MM-DD')
      from big_s s cross join generate_series(0, 5) k`);
    await exec(sql`insert into screenshots (id, organization_id, session_id, membership_id, captured_at, storage_key, status, window_start)
      select gen_random_uuid(), ${orgId}::uuid, s.id, s.membership_id, s.started_at + make_interval(mins => 10 * k + 3), 'big/' || s.id || '/' || k, 'READY', s.started_at + make_interval(mins => 10 * k)
      from big_s s cross join generate_series(0, 5) k`);

    // Weekly timesheets: the last 8 weeks approved, this week a draft.
    await exec(sql`insert into timesheets (id, organization_id, membership_id, period_start, period_end, status, total_seconds)
      select gen_random_uuid(), ${orgId}::uuid, m.id,
        to_char((date_trunc('week', ${now}::timestamptz at time zone ${TZ}) - make_interval(weeks => w))::date, 'YYYY-MM-DD'),
        to_char((date_trunc('week', ${now}::timestamptz at time zone ${TZ}) - make_interval(weeks => w) + interval '6 days')::date, 'YYYY-MM-DD'),
        case when w = 0 then 'DRAFT' else 'APPROVED' end, 5 * 3600
      from big_m m cross join generate_series(0, 8) w`);

    // Today: a 9-to-5 shift for everyone, and a quarter of the members working right now.
    await exec(sql`insert into shifts (id, organization_id, membership_id, local_date, starts_at, ends_at)
      select gen_random_uuid(), ${orgId}::uuid, id, to_char((${now}::timestamptz at time zone ${TZ})::date, 'YYYY-MM-DD'),
        ((${now}::timestamptz at time zone ${TZ})::date + time '09:00') at time zone ${TZ},
        ((${now}::timestamptz at time zone ${TZ})::date + time '17:00') at time zone ${TZ}
      from big_m`);
    await exec(sql`insert into presence (membership_id, organization_id, status, activity_pct, updated_at)
      select id, ${orgId}::uuid, case when rn % 4 = 0 then 'WORKING' else 'OFFLINE' end, 70, ${now}::timestamptz from big_m`);
  });
  return { members, projects };
}
