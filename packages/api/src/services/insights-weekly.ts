import { and, eq } from 'drizzle-orm';
import { memberships, reminderSends, type Tx } from '@tallywork/db';
import { addDaysToDate, startOfWeek } from '@tallywork/domain';
import type { Deps } from '../context';
import { loadActor, loadOrg } from '../middleware/tenant';
import { getInsights } from './ai-insights';
import { mayUseAssistant } from './assistant/access';
import type { Ctx } from './ctx';
import { notify } from './notify';

export const WEEKLY_INSIGHTS_TYPE = 'insights.weekly';
const TOP = 3;

/**
 * Weekly "needs your attention" summary, on the organization's first day of the week: last week's
 * AI Insights overview, computed with each member's own access (no AI provider; the text is the
 * findings' own titles). Only findings that need attention count; nothing is sent when none do.
 *
 * Each member is handled on their own: the findings are computed first (read only), then the
 * weekly claim and the notification are written together in a savepoint. One member failing is
 * logged and skipped, and never undoes another member's summary, whose email has already gone out.
 * `notify` applies the member's preferences: in-app by default, email only when they turned it on.
 * `compute` is replaceable for tests.
 */
export async function sendWeeklyInsights(tx: Tx, deps: Deps, organizationId: string, today: string, compute: typeof getInsights = getInsights): Promise<number> {
  const org = await loadOrg(tx, organizationId);
  if (startOfWeek(today, org.weekStart) !== today) return 0;
  const lastWeek = { from: addDaysToDate(today, -7), to: addDaysToDate(today, -1) };
  const members = await tx.select({ id: memberships.id, userId: memberships.userId }).from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, 'ACTIVE')));
  let sent = 0;
  for (const m of members) {
    try {
      const actor = await loadActor(tx, { type: 'user', userId: m.userId, sessionId: 'insights-weekly', mfaVerified: true }, organizationId, m.id);
      const x: Ctx = { tx, actor, org, deps, requestId: 'insights-weekly', ip: null, userAgent: null, policyCache: new Map() };
      if (!mayUseAssistant(x)) continue;
      const [already] = await tx.select({ id: reminderSends.membershipId }).from(reminderSends).where(and(eq(reminderSends.membershipId, m.id), eq(reminderSends.kind, WEEKLY_INSIGHTS_TYPE), eq(reminderSends.reminderDate, today)));
      if (already) continue;
      // Inside the savepoint: a database error while computing rolls back only this member's work
      // (Postgres would otherwise abort the whole transaction for everyone after them).
      const delivered = await tx.transaction(async (sp) => {
        const overview = await compute({ ...x, tx: sp }, 'overview', lastWeek);
        const attention = overview.findings.filter((f) => f.severity !== 'info');
        const claimed = await sp.insert(reminderSends).values({ organizationId, membershipId: m.id, kind: WEEKLY_INSIGHTS_TYPE, reminderDate: today }).onConflictDoNothing().returning({ id: reminderSends.membershipId });
        if (!claimed.length || !attention.length) return false;
        await notify(sp, deps, organizationId, [m.id], {
          type: WEEKLY_INSIGHTS_TYPE,
          title: `${attention.length} ${attention.length === 1 ? 'thing needs' : 'things need'} your attention this week`,
          body: attention
            .slice(0, TOP)
            .map((f) => f.title)
            .join(' · '),
          link: '/ai-insights?period=last_week',
        });
        return true;
      });
      if (delivered) sent++;
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', msg: 'weekly insights failed for a member', organization_id: organizationId, membership_id: m.id, error: err instanceof Error ? err.name : 'error' }));
    }
  }
  return sent;
}
