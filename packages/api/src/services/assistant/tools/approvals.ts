import { z } from 'zod';
import { localDate, type Permission } from '@tallywork/domain';
import { listTimeOffRequests } from '../../operations';
import { narrowMemberships } from '../../scope';
import { listManualTime, pageApprovalQueue } from '../../timesheets';
import type { Ctx } from '../../ctx';
import type { Actor } from '../../../context';
import { redactApprovalManualTime, redactApprovalTimeOff, redactApprovalTimesheet } from '../redact';
import { capOutput, has } from './shared';
import type { AssistantTool } from './types';

const KINDS = ['timesheets', 'manual_time', 'time_off'] as const;
type Kind = (typeof KINDS)[number];

const input = z.object({ kind: z.enum(KINDS).optional().describe('Only this queue') }).strict();

/**
 * Each queue needs its approve permission, plus the read permission its list service is scoped by
 * (manual time lists by time:read, time off by time_off:read). A queue the actor can't approve is
 * left out entirely.
 */
const NEEDS: Record<Kind, Permission[]> = {
  timesheets: ['timesheets:approve'],
  manual_time: ['manual_time:approve', 'time:read'],
  time_off: ['time_off:approve', 'time_off:read'],
};
const mayApprove = (a: Actor, k: Kind) => NEEDS[k].every((p) => has(a, p));

/** The people whose requests the actor may decide on: the approve scope, never their own request. */
function approvable(x: Ctx, p: Permission): string[] | undefined {
  const v = narrowMemberships(x.actor, p);
  return v === 'all' ? undefined : v;
}
const notOwn = (x: Ctx) => (r: { membership_id: string }) => r.membership_id !== x.actor.membershipId;
const queue = <T>(items: T[]) => {
  const out = capOutput(items);
  return { count: items.length, items: out.rows, truncated: out.truncated };
};

export const approvalsTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getPendingApprovals',
  description: 'What is waiting for the person’s approval: submitted timesheets, manual time requests and time-off requests, with a count and the names and dates for each queue they may approve.',
  input,
  allowed: (a) => has(a, 'timesheets:approve') || has(a, 'manual_time:approve') || has(a, 'time_off:approve'),
  statusKey: 'checking_approvals',
  async run(x, q) {
    const kinds = KINDS.filter((k) => (!q.kind || q.kind === k) && mayApprove(x.actor, k));
    const data: Partial<Record<Kind, ReturnType<typeof queue>>> = {};
    for (const k of kinds) {
      if (k === 'timesheets') {
        // The queue service already leaves out the approver's own timesheet (unless they own the organization).
        // Paged: the real total, and at most 50 rows built (the full queue computes per-row flags we'd discard).
        const page = await pageApprovalQueue(x, { status: 'SUBMITTED', page: 1, pageSize: 50 });
        data.timesheets = { count: page.total, items: page.data.map(redactApprovalTimesheet), truncated: page.total > page.data.length };
      } else if (k === 'manual_time') {
        const ids = approvable(x, 'manual_time:approve');
        const rows = (await listManualTime(x, { status: 'PENDING', membershipIds: ids })).filter(notOwn(x));
        const scoped = ids ? rows.filter((r) => ids.includes(r.membership_id)) : rows;
        data.manual_time = queue(scoped.map((r) => redactApprovalManualTime(r, localDate(new Date(r.started_at), x.org.timezone))));
      } else {
        const ids = approvable(x, 'time_off:approve');
        const rows = (await listTimeOffRequests(x, { status: 'PENDING', membershipIds: ids })).filter(notOwn(x));
        const scoped = ids ? rows.filter((r) => ids.includes(r.membership_id)) : rows;
        data.time_off = queue(scoped.map(redactApprovalTimeOff));
      }
    }
    return { data };
  },
};
