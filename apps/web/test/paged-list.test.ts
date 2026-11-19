import { describe, expect, it } from 'vitest';
import { samePagedList } from '../lib/paging';

// A paged list keeps showing the previous page while the next loads, but never another filter's or
// tab's results under the new heading (QA BUG-24).
describe('samePagedList', () => {
  it('is the same list when only the page or page size changes', () => {
    expect(samePagedList('/timesheets/approvals?status=APPROVED&page=1&page_size=50', '/timesheets/approvals?status=APPROVED&page=2&page_size=50')).toBe(true);
    expect(samePagedList('/expenses?page=1&page_size=50&status=SUBMITTED', '/expenses?status=SUBMITTED&page=1&page_size=100')).toBe(true);
  });

  it('is another list when a filter, tab or search changes', () => {
    expect(samePagedList('/timesheets/approvals?status=SUBMITTED&page=1', '/timesheets/approvals?status=APPROVED&page=1')).toBe(false);
    expect(samePagedList('/tasks?q=a&page=1', '/tasks?q=ab&page=1')).toBe(false);
    expect(samePagedList('/tasks?page=1', '/tasks?project_id=p1&page=1')).toBe(false);
    expect(samePagedList('/tasks?page=1', '/time-entries?page=1')).toBe(false);
  });

  it('is never the same list without a previous one', () => {
    expect(samePagedList(null, '/tasks?page=1')).toBe(false);
    expect(samePagedList(undefined, '/tasks')).toBe(false);
  });
});
