'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { NotificationDto } from '@tallywork/contracts';
import { groupNotifications } from '@tallywork/domain/notifications';
import { cx, fmtRelative } from '@tallywork/ui';
import { t } from '@/lib/i18n';

/**
 * The bell's list, loaded when the bell is first opened (not on every page's first load).
 * Notifications of one type in a row are grouped ("+N more"); urgent and important ones say so.
 * Nothing is hidden: every notification stays in the list and in the unread count.
 */
export default function NotificationList({ data, base, onOpen }: { data: { data: NotificationDto[] }; base: string; onOpen: (items: NotificationDto[]) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!data.data.length) return <li className="px-4 py-8 text-center text-sm text-text-muted">{t('shell.allCaughtUp')}</li>;
  return (
    <>
      {groupNotifications(data.data).map((g) => {
        const n = g.items[0]!;
        const more = g.items.length - 1;
        const unread = g.items.some((i) => !i.read_at);
        return (
          <li key={n.id}>
            <Link href={n.link ? `${base}${n.link}` : base} onClick={() => onOpen(g.items)} className={cx('flex gap-3 px-4 py-3 hover:bg-surface-muted', unread && 'bg-interactive-soft/40')}>
              <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', !unread ? 'bg-transparent' : n.priority === 'critical' ? 'bg-danger' : 'bg-interactive')} />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  {n.priority !== 'info' && <span className={cx('mr-1.5 text-2xs font-semibold uppercase', n.priority === 'critical' ? 'text-danger' : 'text-warning')}>{t(n.priority === 'critical' ? 'shell.urgent' : 'shell.important')}</span>}
                  {n.title}
                </span>
                {n.body && <span className="block truncate text-xs text-text-muted">{n.body}</span>}
                <span className="mt-0.5 block text-2xs text-text-faint">{fmtRelative(n.created_at)}</span>
              </span>
            </Link>
            {more > 0 && (
              <button type="button" aria-expanded={!!open[n.id]} onClick={() => setOpen((o) => ({ ...o, [n.id]: !o[n.id] }))} className="ml-9 pb-2 text-xs font-medium text-interactive hover:underline">
                {t('shell.moreLikeThis', { count: more })}
              </button>
            )}
            {more > 0 && open[n.id] && (
              <ul className="pb-2 pl-9 pr-4">
                {g.items.slice(1).map((i) => (
                  <li key={i.id} className="py-1 text-xs text-text-muted">
                    {i.title} · {fmtRelative(i.created_at)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}
