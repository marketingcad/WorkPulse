import { describe, expect, it } from 'vitest';
import type { ApprovalQueueItemDto, OffsetPage } from '@tallywork/contracts';
import { withoutDecided } from '../components/timesheets/queue';

/** QA audit, 11 Nov 2026 (C-11): a decided timesheet left Pending only after a slow full reload. */
const row = (id: string): ApprovalQueueItemDto => ({ timesheet_id: id, membership_id: 'm', worker_name: 'Wes', period_start: '2026-11-09', period_end: '2026-11-15', status: 'SUBMITTED', submitted_at: null, total_seconds: 3600 }) as ApprovalQueueItemDto;
const page: OffsetPage<ApprovalQueueItemDto> = { data: [row('a'), row('b')], total: 2, page: 1, page_size: 25 };

describe('withoutDecided', () => {
  it('takes an approved timesheet out of Pending at once', () => {
    expect(withoutDecided(page, 'a', 'APPROVED', 'SUBMITTED')).toEqual({ ...page, data: [row('b')], total: 1 });
  });

  it('leaves the list alone when the timesheet still belongs to the tab, or is not in it', () => {
    expect(withoutDecided(page, 'a', 'SUBMITTED', 'SUBMITTED')).toBe(page);
    expect(withoutDecided(page, 'zzz', 'APPROVED', 'SUBMITTED')).toBe(page);
    expect(withoutDecided(undefined, 'a', 'APPROVED', 'SUBMITTED')).toBeUndefined();
  });
});
