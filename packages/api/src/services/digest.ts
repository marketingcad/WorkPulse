import { and, eq, inArray, sql } from 'drizzle-orm';
import { digestSends, manualTimeRequests, memberships, notificationPreferences, rollupWorkerDay, timeOffRequests, timesheets, users, type Tx } from '@tallywork/db';
import { addDaysToDate, startOfWeek } from '@tallywork/domain';
import type { Deps } from '../context';
import type { Ctx } from './ctx';
import { loadActor, loadOrg } from '../middleware/tenant';
import { narrowMemberships } from './scope';

export const DIGEST_TYPE = 'digest.daily';

const hm = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

/**
 * Daily summary email for members who turned it on (notification preference `digest.daily`,
 * email). Content follows what the member may see: their own time, plus team totals and pending
 * approvals for managers. Sent at most once per member per day.
 */
export async function sendDigests(tx: Tx, deps: Deps, organizationId: string, today: string): Promise<number> {
  const optedIn = await tx
    .select({ id: memberships.id, userId: memberships.userId, email: users.email, name: users.name })
    .from(notificationPreferences)
    .innerJoin(memberships, eq(memberships.id, notificationPreferences.membershipId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(notificationPreferences.type, DIGEST_TYPE), eq(notificationPreferences.email, true), eq(memberships.status, 'ACTIVE')));
  if (!optedIn.length) return 0;
  const org = await loadOrg(tx, organizationId);
  const yesterday = addDaysToDate(today, -1);
  const weekStart = startOfWeek(yesterday, org.weekStart);
  let sent = 0;
  for (const m of optedIn) {
    const claimed = await tx.insert(digestSends).values({ organizationId, membershipId: m.id, digestDate: today }).onConflictDoNothing().returning({ id: digestSends.membershipId });
    if (!claimed.length) continue;
    const actor = await loadActor(tx, { type: 'user', userId: m.userId, sessionId: 'digest', mfaVerified: true }, organizationId, m.id);
    const x = { tx, actor, org } as Pick<Ctx, 'tx' | 'actor' | 'org'>;
    const lines = [`Your Tallywork summary for ${yesterday}`, ''];

    const secs = async (members: string[] | 'all', from: string, to: string) => {
      const [r] = await tx
        .select({ s: sql<number>`coalesce(sum(${rollupWorkerDay.trackedSeconds} + ${rollupWorkerDay.manualSeconds}),0)::int`, n: sql<number>`count(distinct ${rollupWorkerDay.membershipId})::int` })
        .from(rollupWorkerDay)
        .where(and(sql`${rollupWorkerDay.localDate} between ${from} and ${to}`, members === 'all' ? undefined : inArray(rollupWorkerDay.membershipId, members.length ? members : ['00000000-0000-7000-8000-000000000000'])));
      return { seconds: r?.s ?? 0, workers: r?.n ?? 0 };
    };

    if (actor.grants['tracking:track']) {
      const mine = await secs([m.id], yesterday, yesterday);
      const week = await secs([m.id], weekStart, yesterday);
      lines.push(`You worked ${hm(mine.seconds)} (${hm(week.seconds)} this week).`);
      const [ts] = await tx.select({ status: timesheets.status, comment: timesheets.comment }).from(timesheets).where(eq(timesheets.membershipId, m.id)).orderBy(sql`${timesheets.periodStart} desc`).limit(1);
      if (ts && (ts.status === 'REJECTED' || (ts.status === 'DRAFT' && ts.comment))) lines.push(`Your timesheet needs changes${ts.comment ? `: “${ts.comment}”` : ''}.`);
    }
    const team = narrowMemberships(x.actor, 'time:read');
    if (team === 'all' || team.length > 1) {
      const t = await secs(team, yesterday, yesterday);
      lines.push(`${team === 'all' ? 'Your organization' : 'Your team'}: ${hm(t.seconds)} across ${t.workers} ${t.workers === 1 ? 'person' : 'people'}.`);
    }
    const pending: string[] = [];
    const scopeFilter = (col: Parameters<typeof inArray>[0], v: string[] | 'all') => (v === 'all' ? undefined : inArray(col, v.length ? v : ['00000000-0000-7000-8000-000000000000']));
    if (actor.grants['timesheets:approve']) {
      const v = narrowMemberships(x.actor, 'timesheets:approve');
      const [a] = await tx.select({ n: sql<number>`count(*)::int` }).from(timesheets).where(and(eq(timesheets.status, 'SUBMITTED'), scopeFilter(timesheets.membershipId, v), sql`${timesheets.membershipId} <> ${m.id}`));
      if (a?.n) pending.push(`${a.n} timesheet${a.n === 1 ? '' : 's'}`);
    }
    if (actor.grants['manual_time:approve']) {
      const v = narrowMemberships(x.actor, 'manual_time:approve');
      const [a] = await tx.select({ n: sql<number>`count(*)::int` }).from(manualTimeRequests).where(and(eq(manualTimeRequests.status, 'PENDING'), scopeFilter(manualTimeRequests.membershipId, v), sql`${manualTimeRequests.membershipId} <> ${m.id}`));
      if (a?.n) pending.push(`${a.n} manual time request${a.n === 1 ? '' : 's'}`);
    }
    if (actor.grants['time_off:approve']) {
      const v = narrowMemberships(x.actor, 'time_off:approve');
      const [a] = await tx.select({ n: sql<number>`count(*)::int` }).from(timeOffRequests).where(and(eq(timeOffRequests.status, 'PENDING'), scopeFilter(timeOffRequests.membershipId, v), sql`${timeOffRequests.membershipId} <> ${m.id}`));
      if (a?.n) pending.push(`${a.n} time off request${a.n === 1 ? '' : 's'}`);
    }
    if (pending.length) lines.push(`Waiting for your approval: ${pending.join(', ')}.`);
    lines.push('', `${deps.config.appUrl}/o/${organizationId}`, '', 'You get this email because the daily summary is on in your notification settings.');
    await deps.mailer.send({ to: m.email, subject: `Your daily summary — ${org.name}`, text: lines.join('\n') }).catch(() => undefined);
    sent++;
  }
  return sent;
}
