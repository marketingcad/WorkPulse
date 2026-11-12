import type { ApprovalQueueItemDto, OffsetPage } from '@tallywork/contracts';

/**
 * The approval queue page after a decision: the decided timesheet leaves the tab it no longer belongs
 * to (approved or rejected out of Pending, reopened out of Approved), at once. The full list still
 * refreshes in the background. Pure (test/queue.test.ts).
 *
 * QA audit 11 Nov 2026 (C-11): on a slow server the decided row stayed in Pending for 3-5 s, which
 * invited a second decision on a timesheet already decided.
 */
export function withoutDecided(page: OffsetPage<ApprovalQueueItemDto> | undefined, timesheetId: string, newStatus: string, tabStatus: string): OffsetPage<ApprovalQueueItemDto> | undefined {
  if (!page || newStatus === tabStatus || !page.data.some((r) => r.timesheet_id === timesheetId)) return page;
  return { ...page, data: page.data.filter((r) => r.timesheet_id !== timesheetId), total: Math.max(0, page.total - 1) };
}
