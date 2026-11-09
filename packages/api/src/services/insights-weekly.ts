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
 * At most once per member per week (a reminder_sends claim). `notify` applies the member's
 * preferences: in-app by default, email only when they turned it on.
 */
export async function sendWeeklyInsights(tx: Tx, deps: Deps, organizationId: string, today: string): Promise<number> {
  const org = await loadOrg(tx, organizationId);
  if (startOfWeek(today, org.weekStart) !== today) return 0;
  const lastWeek = { from: addDaysToDate(today, -7), to: addDaysToDate(today, -1) };
  const members = await tx.select({ id: memberships.id, userId: memberships.userId }).from(memberships).where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, 'ACTIVE')));
  let sent = 0;
  for (const m of members) {
    const actor = await loadActor(tx, { type: 'user', userId: m.userId, sessionId: 'insights-weekly', mfaVerified: true }, organizationId, m.id);
    const x: Ctx = { tx, actor, org, deps, requestId: 'insights-weekly', ip: null, userAgent: null, policyCache: new Map() };
    if (!mayUseAssistant(x)) continue;
    const claimed = await tx.insert(reminderSends).values({ organizationId, membershipId: m.id, kind: WEEKLY_INSIGHTS_TYPE, reminderDate: today }).onConflictDoNothing().returning({ id: reminderSends.membershipId });
    if (!claimed.length) continue;
    const overview = await getInsights(x, 'overview', lastWeek);
    const attention = overview.findings.filter((f) => f.severity !== 'info');
    if (!attention.length) continue;
    await notify(tx, deps, organizationId, [m.id], {
      type: WEEKLY_INSIGHTS_TYPE,
      title: `${attention.length} ${attention.length === 1 ? 'thing needs' : 'things need'} your attention this week`,
      body: attention
        .slice(0, TOP)
        .map((f) => f.title)
        .join(' · '),
      link: '/ai-insights?period=last_week',
    });
    sent++;
  }
  return sent;
}
