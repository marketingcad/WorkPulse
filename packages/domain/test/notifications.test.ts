import { describe, expect, it } from 'vitest';
import { groupNotifications, notificationPriority } from '../src/notifications';

const n = (id: string, type: string, created_at: string, read_at: string | null = null) => ({ id, type, created_at, read_at });

describe('notificationPriority', () => {
  it('ranks known types and defaults to info', () => {
    expect(notificationPriority('budget.exceeded')).toBe('critical');
    expect(notificationPriority('timesheet.submitted')).toBe('important');
    expect(notificationPriority('timesheet.approved')).toBe('info');
    expect(notificationPriority('unknown.x')).toBe('info');
  });
});

describe('groupNotifications', () => {
  it('groups consecutive notifications of one type within the window, newest first', () => {
    const g = groupNotifications([n('a', 'timesheet.submitted', '2026-11-10T12:00:00Z'), n('b', 'timesheet.submitted', '2026-11-10T11:00:00Z'), n('c', 'timesheet.submitted', '2026-11-10T10:00:00Z')]);
    expect(g).toHaveLength(1);
    expect(g[0]!.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });
  it('never groups critical types', () => {
    expect(groupNotifications([n('a', 'budget.exceeded', '2026-11-10T12:00:00Z'), n('b', 'budget.exceeded', '2026-11-10T11:00:00Z')])).toHaveLength(2);
  });
  it('keeps order and breaks groups on another type or outside the window', () => {
    expect(groupNotifications([n('a', 'timesheet.submitted', '2026-11-10T12:00:00Z'), n('b', 'budget.warning', '2026-11-10T11:00:00Z'), n('c', 'timesheet.submitted', '2026-11-10T10:00:00Z')]).map((g) => g.type)).toEqual(['timesheet.submitted', 'budget.warning', 'timesheet.submitted']);
    expect(groupNotifications([n('a', 'timesheet.submitted', '2026-11-10T12:00:00Z'), n('b', 'timesheet.submitted', '2026-11-09T06:00:00Z')])).toHaveLength(2);
  });
});
