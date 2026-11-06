import { z } from 'zod';
import { isoDate } from '@tallywork/contracts';
import { addDaysToDate, localDate, periodFor, type Period } from '@tallywork/domain';
import { listMemberOptions } from '../../org';
import { runReport, type ReportParams } from '../../reports';
import { canSeeMembership } from '../../scope';
import type { Ctx } from '../../ctx';
import { redactTimesheetStatus, type TimesheetState } from '../redact';
import { capOutput, has } from './shared';
import type { AssistantTool } from './types';

/** At most this many pay periods per call; a longer range is cut short and the output says so. */
export const MAX_PERIODS = 5;

const input = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must be on or before to', path: ['to'] });

const STATES: Record<string, TimesheetState> = { DRAFT: 'draft', SUBMITTED: 'submitted', APPROVED: 'approved', REJECTED: 'rejected' };

/** The organization's pay periods (weekly, biweekly, ...) that overlap [from..to], at most MAX_PERIODS. */
function periodsIn(x: Ctx, from: string, to: string): { periods: Period[]; clamped: boolean } {
  const periods: Period[] = [];
  let p = periodFor(from, x.org.payPeriod, x.org.weekStart);
  while (p.start <= to) {
    if (periods.length === MAX_PERIODS) return { periods, clamped: true };
    periods.push(p);
    p = periodFor(addDaysToDate(p.end, 1), x.org.payPeriod, x.org.weekStart);
  }
  return { periods, clamped: false };
}

export const timesheetStatusTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getTimesheetStatus',
  description: `Timesheet status per person and pay period (defaults to the current period): not submitted, draft, submitted, approved or rejected. Covers at most ${MAX_PERIODS} pay periods per call; a longer range is cut short.`,
  input,
  allowed: (a) => has(a, 'timesheets:read') && has(a, 'reports:read'),
  statusKey: 'checking_timesheets',
  async run(x, q) {
    const today = localDate(x.deps.now(), x.org.timezone);
    const start = q.from ?? q.to ?? today;
    const { periods, clamped } = periodsIn(x, start, q.to ?? q.from ?? today);
    const from = periods[0]!.start;
    const to = periods[periods.length - 1]!.end;
    const params: ReportParams = { from, to, billable: 'all' };
    const report = await runReport(x, 'timesheet-approval', params);

    // Joined on membership id (never sent), so two people with the same name stay apart.
    type Row = { membershipId: string; name: string; period: Period; status: TimesheetState };
    const rows = new Map<string, Row>();
    const key = (m: string, start: string) => `${m}|${start}`;
    for (const r of report.rows) {
      const m = String(r.membership_id);
      const period = { start: String(r.period_start), end: String(r.period_end) };
      rows.set(key(m, period.start), { membershipId: m, name: String(r.worker ?? ''), period, status: STATES[String(r.status)] ?? 'draft' });
    }
    // Active members with tracking on, in scope for both members:read and timesheets:read: each
    // period without a timesheet row is not submitted.
    if (has(x.actor, 'members:read')) {
      for (const m of await listMemberOptions(x)) {
        if (m.status !== 'ACTIVE' || !m.tracking_enabled || !canSeeMembership(x.actor, 'timesheets:read', m.id)) continue;
        for (const p of periods) if (!rows.has(key(m.id, p.start))) rows.set(key(m.id, p.start), { membershipId: m.id, name: m.name, period: p, status: 'not_submitted' });
      }
    }
    const sorted = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name) || a.membershipId.localeCompare(b.membershipId) || a.period.start.localeCompare(b.period.start));
    const counts: Record<TimesheetState, number> = { not_submitted: 0, draft: 0, submitted: 0, approved: 0, rejected: 0 };
    for (const r of sorted) counts[r.status]++;
    const out = capOutput(sorted.map((r) => redactTimesheetStatus(r.name, r.status, r.period)));
    return {
      data: {
        from,
        to,
        counts,
        rows: out.rows,
        truncated: out.truncated,
        ...(clamped ? { note: `Only the first ${MAX_PERIODS} pay periods are included; ask again for later dates.` } : {}),
      },
    };
  },
};
