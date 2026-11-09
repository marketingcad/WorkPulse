import { z } from 'zod';
import { DomainError } from '@tallywork/domain';
import { reportCatalog, runReport } from '../../reports';
import { redactReport } from '../redact';
import { dateRange, has } from './shared';
import type { AssistantTool } from './types';

const input = dateRange({
  key: z.string().trim().min(1).max(60).describe('Report key from the Report library, e.g. time-activity, timesheet-approval, attendance, time-off'),
  group_by: z.array(z.string().max(30)).max(3).optional(),
});

/**
 * Runs one of the person's own Report library reports (same permission, scope and filters as the
 * report page) so the model can summarize it. The model never computes the figures: it reads the
 * report's own totals, summary and top rows.
 */
export const reportSummaryTool: AssistantTool<z.infer<typeof input>> = {
  name: 'summarizeReport',
  description:
    'Run a Report library report the person may run, for a date range (at most 93 days), and return its title, totals, summary and up to 15 rows, to summarize key findings. Only reports listed in their Report library are available.',
  input,
  allowed: (a) => has(a, 'reports:read'),
  statusKey: 'summarizing_report',
  async run(x, q) {
    const listed = reportCatalog(x).find((r) => r.key === q.key && !r.hidden);
    if (!listed) throw new DomainError('forbidden', 'forbidden', 'Not permitted.');
    const result = await runReport(x, listed.key, { from: q.from, to: q.to, billable: 'all', ...(q.group_by?.length ? { group_by: q.group_by } : {}) });
    return { data: redactReport({ ...result, title: listed.title, key: listed.key }, { from: q.from, to: q.to }, has(x.actor, 'reports:finance')) };
  },
};
