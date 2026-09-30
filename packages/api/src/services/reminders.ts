import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  holidays,
  memberships,
  notificationPreferences,
  reminderSends,
  rollupWorkerDay,
  timeOffRequests,
  trackingSessions,
  users,
  workSchedules,
  workerProfiles,
  type OrgSettings,
  type Tx,
} from '@tallywork/db';
import { addDaysToDate, dayOfWeek, localDate, startOfWeek, zonedParts } from '@tallywork/domain';
import type { Deps } from '../context';
import { notify } from './notify';

export const MISSING_TIME = 'time.missing';
const DEFAULT_CHECK_AT = '18:00';
const MON_FRI = [1, 2, 3, 4, 5];

const hm = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

/**
 * Missing-time reminder, run every minute. From the check time on each working day, members
 * who logged less than the daily minimum (or, on the last working day of the week, less than
 * the weekly minimum) get one in-app notification and email. Days off: weekends or the days
 * outside the member's work schedule, holidays and approved time off. Members with a timer
 * running are checked again once it stops.
 */
export async function runMissingTimeReminders(
  tx: Tx,
  deps: Deps,
  org: { id: string; timezone: string; weekStart: number; settings: OrgSettings },
  now: Date,
): Promise<number> {
  const s = org.settings;
  if (!s.missingTimeReminder || (!s.minDailySeconds && !s.minWeeklySeconds)) return 0;
  const p = zonedParts(now, org.timezone);
  const clock = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  if (clock < (s.missingTimeCheckAt ?? DEFAULT_CHECK_AT)) return 0;
  const today = localDate(now, org.timezone);
  const [holiday] = await tx.select({ d: holidays.date }).from(holidays).where(eq(holidays.date, today)).limit(1);
  if (holiday) return 0;

  const members = await tx
    .select({ id: memberships.id, email: users.email })
    .from(memberships)
    .innerJoin(workerProfiles, eq(workerProfiles.membershipId, memberships.id))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.status, 'ACTIVE'), eq(workerProfiles.trackingEnabled, true)));
  if (!members.length) return 0;
  const ids = members.map((m) => m.id);

  const already = new Set(
    (await tx.select({ m: reminderSends.membershipId }).from(reminderSends).where(and(eq(reminderSends.kind, MISSING_TIME), eq(reminderSends.reminderDate, today), inArray(reminderSends.membershipId, ids)))).map((r) => r.m),
  );
  const pending = ids.filter((id) => !already.has(id));
  if (!pending.length) return 0;

  const weekStart = startOfWeek(today, org.weekStart);
  const weekEnd = addDaysToDate(weekStart, 6);
  const [schedules, off, running, logged] = await Promise.all([
    tx.select().from(workSchedules).where(and(inArray(workSchedules.membershipId, pending), lte(workSchedules.effectiveFrom, today), sql`(${workSchedules.effectiveTo} is null or ${workSchedules.effectiveTo} >= ${today})`)),
    tx.select({ m: timeOffRequests.membershipId }).from(timeOffRequests).where(and(inArray(timeOffRequests.membershipId, pending), eq(timeOffRequests.status, 'APPROVED'), lte(timeOffRequests.startDate, today), gte(timeOffRequests.endDate, today))),
    tx.select({ m: trackingSessions.membershipId }).from(trackingSessions).where(and(inArray(trackingSessions.membershipId, pending), inArray(trackingSessions.state, ['ACTIVE', 'PAUSED']))),
    tx
      .select({ m: rollupWorkerDay.membershipId, d: rollupWorkerDay.localDate, s: sql<number>`sum(${rollupWorkerDay.trackedSeconds} + ${rollupWorkerDay.manualSeconds})::int` })
      .from(rollupWorkerDay)
      .where(and(inArray(rollupWorkerDay.membershipId, pending), gte(rollupWorkerDay.localDate, weekStart), lte(rollupWorkerDay.localDate, today)))
      .groupBy(rollupWorkerDay.membershipId, rollupWorkerDay.localDate),
  ]);
  const onLeave = new Set(off.map((o) => o.m));
  const working = new Set(running.map((r) => r.m));
  const workDays = (m: string) => {
    const sch = schedules.filter((x) => x.membershipId === m).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];
    return sch ? [...new Set(sch.days.map((d) => d.dow))] : MON_FRI;
  };

  let sent = 0;
  const prefs = await tx.select().from(notificationPreferences).where(and(eq(notificationPreferences.type, MISSING_TIME), inArray(notificationPreferences.membershipId, pending)));
  for (const m of members) {
    if (already.has(m.id) || onLeave.has(m.id) || working.has(m.id)) continue;
    const days = workDays(m.id);
    if (!days.includes(dayOfWeek(today))) continue;
    const todaySecs = logged.find((l) => l.m === m.id && l.d === today)?.s ?? 0;
    const weekSecs = logged.filter((l) => l.m === m.id).reduce((a, l) => a + l.s, 0);
    // The last working day of the week that is still ahead of or equal to today.
    let lastWorkDay = weekStart;
    for (let d = weekStart; d <= weekEnd; d = addDaysToDate(d, 1)) if (days.includes(dayOfWeek(d))) lastWorkDay = d;
    const problems: string[] = [];
    if (s.minDailySeconds && todaySecs < s.minDailySeconds) problems.push(`You logged ${hm(todaySecs)} today; the minimum is ${hm(s.minDailySeconds)}.`);
    if (s.minWeeklySeconds && today === lastWorkDay && weekSecs < s.minWeeklySeconds) problems.push(`You logged ${hm(weekSecs)} this week; the minimum is ${hm(s.minWeeklySeconds)}.`);
    if (!problems.length) continue;
    const claimed = await tx.insert(reminderSends).values({ organizationId: org.id, membershipId: m.id, kind: MISSING_TIME, reminderDate: today }).onConflictDoNothing().returning({ m: reminderSends.membershipId });
    if (!claimed.length) continue;
    const n = { type: MISSING_TIME, title: 'Your timesheet is missing time', body: `${problems.join(' ')} Add the time you worked so your timesheet is complete.`, link: `/timesheets?date=${today}` };
    // In-app per the member's preference; email unless they turned this reminder's email off.
    await notify(tx, deps, org.id, [m.id], n);
    const pref = prefs.find((x) => x.membershipId === m.id);
    if (!pref) await deps.mailer.send({ to: m.email, subject: n.title, text: `${n.body}\n\n${deps.config.appUrl}/o/${org.id}${n.link}` }).catch(() => undefined);
    sent++;
  }
  return sent;
}
