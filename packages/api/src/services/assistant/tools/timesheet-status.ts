import { z } from 'zod';
import { isoDate } from '@tallywork/contracts';
import { addDaysToDate, localDate, startOfWeek } from '@tallywork/domain';
import { listMemberOptions } from '../../org';
import { runReport, type ReportParams } from '../../reports';
import { canSeeMembership } from '../../scope';
import { redactTimesheetStatus, type TimesheetState } from '../redact';
import { capOutput, has, MAX_RANGE_DAYS } from './shared';
import type { AssistantTool } from './types';

const input = z
  .object({ from: isoDate.optional(), to: isoDate.optional() })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must be on or before to', path: ['to'] })
  .refine((v) => !v.from || !v.to || (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 + 1 <= MAX_RANGE_DAYS, { message: `Choose a range of up to ${MAX_RANGE_DAYS} days`, path: ['to'] });

const STATES: Record<string, TimesheetState> = { DRAFT: 'draft', SUBMITTED: 'submitted', APPROVED: 'approved', REJECTED: 'rejected' };

export const timesheetStatusTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getTimesheetStatus',
  description: 'Timesheet status per person for a date range (defaults to the current week): not submitted, draft, submitted, approved or rejected.',
  input,
  allowed: (a) => has(a, 'timesheets:read') && has(a, 'reports:read'),
  statusKey: 'checking_timesheets',
  async run(x, q) {
    const weekFrom = startOfWeek(localDate(x.deps.now(), x.org.timezone), x.org.weekStart);
    const from = q.from ?? (q.to ? addDaysToDate(q.to, -6) : weekFrom);
    const to = q.to ?? addDaysToDate(from, 6);
    const params: ReportParams = { from, to, billable: 'all' };
    const report = await runReport(x, 'timesheet-approval', params);

    const rows: Array<ReturnType<typeof redactTimesheetStatus>> = [];
    const withTimesheet = new Set<string>();
    for (const r of report.rows) {
      const name = String(r.worker ?? '');
      withTimesheet.add(name);
      rows.push(redactTimesheetStatus(name, STATES[String(r.status)] ?? 'draft', { start: String(r.period_start), end: String(r.period_end) }));
    }
    // Active members with tracking on, in scope for both members:read and timesheets:read, who have
    // no timesheet row in the range. (The report rows carry names only, so they are matched by name.)
    if (has(x.actor, 'members:read')) {
      const members = await listMemberOptions(x);
      for (const m of members) {
        if (m.status !== 'ACTIVE' || !m.tracking_enabled || withTimesheet.has(m.name)) continue;
        if (!canSeeMembership(x.actor, 'timesheets:read', m.id)) continue;
        rows.push(redactTimesheetStatus(m.name, 'not_submitted', null));
      }
    }
    rows.sort((a, b) => a.name.localeCompare(b.name) || (a.period_start ?? '').localeCompare(b.period_start ?? ''));
    const counts: Record<TimesheetState, number> = { not_submitted: 0, draft: 0, submitted: 0, approved: 0, rejected: 0 };
    for (const r of rows) counts[r.status]++;
    const out = capOutput(rows);
    return { data: { from, to, counts, rows: out.rows, truncated: out.truncated } };
  },
};
