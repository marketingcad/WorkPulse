import { z } from 'zod';
import { DomainError } from '@tallywork/domain';
import { REPORTS, reportCatalog, runReport } from '../../reports';
import { redactReport } from '../redact';
import { dateRange, has } from './shared';
import type { AssistantTool } from './types';

/**
 * Reports the assistant may summarize: an allowlist, not a filter. Monitoring reports (apps and
 * URLs, work sessions with idle time, breaks) and the audit log never reach the AI provider, even
 * for people who may open them in the Report library.
 */
export const SUMMARIZABLE_REPORTS = ['time-activity', 'manual-time', 'timesheet-approval', 'attendance', 'time-off', 'payroll', 'billing'] as const;

const input = dateRange({
  key: z.string().trim().min(1).max(60).describe(`Report key: one of ${SUMMARIZABLE_REPORTS.join(', ')} (only those the person may run)`),
  group_by: z.array(z.string().max(30)).max(3).optional(),
});

/**
 * Runs one of the person's own Report library reports (same permission, scope and filters as the
 * report page) so the model can summarize it. The model never computes the figures: it reads the
 * report's own totals, summary and top rows. Page filters (members, teams, projects) are not
 * applied; the output says so.
 */
export const reportSummaryTool: AssistantTool<z.infer<typeof input>> = {
  name: 'summarizeReport',
  description: `Run a Report library report the person may run, for a date range (at most 93 days), and return its title, totals, summary and up to 15 rows, to summarize key findings. Keys: ${SUMMARIZABLE_REPORTS.join(', ')}.`,
  input,
  allowed: (a) => has(a, 'reports:read'),
  statusKey: 'summarizing_report',
  async run(x, q) {
    const mine = reportCatalog(x).filter((r) => !r.hidden && (SUMMARIZABLE_REPORTS as readonly string[]).includes(r.key));
    const listed = mine.find((r) => r.key === q.key);
    if (!listed) {
      // A real report the person may not run here (or a monitoring one): refused. A made-up key: say so.
      if (REPORTS.some((r) => r.key === q.key)) throw new DomainError('forbidden', 'forbidden', 'Not permitted.');
      return { data: { error: 'Unknown report', available: mine.map((r) => ({ key: r.key, title: r.title })) } };
    }
    const result = await runReport(x, listed.key, { from: q.from, to: q.to, billable: 'all', ...(q.group_by?.length ? { group_by: q.group_by } : {}) });
    return {
      data: {
        ...redactReport({ ...result, title: listed.title, key: listed.key }, { from: q.from, to: q.to }, has(x.actor, 'reports:finance')),
        note: 'Covers everything the person may see for these dates; member, team and project filters on the report page are not applied.',
      },
    };
  },
};
