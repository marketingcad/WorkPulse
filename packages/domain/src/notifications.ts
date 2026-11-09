/**
 * Notification priority and grouping: fixed rules, never AI. Priority only orders attention; every
 * notification is still shown and counted as unread, and critical ones are never folded into a group.
 */
export type NotificationPriority = 'critical' | 'important' | 'info';

export const NOTIFICATION_PRIORITY: Record<string, NotificationPriority> = {
  'budget.exceeded': 'critical',
  'invoice.overdue': 'critical',
  'limit.reached': 'critical',
  'payroll.bank_details_changed': 'critical',
  'device.offline': 'critical',
  'timesheet.submitted': 'important',
  'timesheet.rejected': 'important',
  'timesheet.changes_requested': 'important',
  'manual_time.requested': 'important',
  'time_off.requested': 'important',
  'budget.warning': 'important',
  'time.needs_review': 'important',
  'timesheet.late_time': 'important',
  'shift.not_started': 'important',
  'expense.submitted': 'important',
  'insights.weekly': 'important',
};

export function notificationPriority(type: string): NotificationPriority {
  return Object.hasOwn(NOTIFICATION_PRIORITY, type) ? NOTIFICATION_PRIORITY[type]! : 'info';
}

/** Consecutive notifications (newest first) of the same non-critical type within `windowHours` form one group. */
export function groupNotifications<T extends { id: string; type: string; created_at: string; read_at: string | null }>(items: T[], windowHours = 24): Array<{ type: string; items: T[] }> {
  const out: Array<{ type: string; items: T[] }> = [];
  const windowMs = windowHours * 3_600_000;
  for (const item of items) {
    const last = out[out.length - 1];
    const head = last?.items[0];
    if (last && head && last.type === item.type && notificationPriority(item.type) !== 'critical' && Date.parse(head.created_at) - Date.parse(item.created_at) <= windowMs) last.items.push(item);
    else out.push({ type: item.type, items: [item] });
  }
  return out;
}
