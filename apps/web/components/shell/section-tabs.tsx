'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TAB_CLASS } from '@tallywork/ui';
import { t } from '@/lib/i18n';
import { useOrg } from '@/lib/org';
import { activeNav, filterNav } from './nav';

/**
 * Pages grouped under one sidebar item (Members · Teams, Schedule · Attendance, the Settings
 * area) show their siblings as tabs. Each tab is a link to its own page, so every URL keeps
 * working and each page keeps its own permission check. Shown only on the tab pages themselves
 * (not on a member's profile under /workers/…), and only when the person can open two or more.
 */
export function SectionTabs() {
  const org = useOrg();
  const pathname = usePathname();
  const path = pathname.slice(org.base.length);
  const hit = activeNav(filterNav(org.can, org.grants, org.isManagerView), path);
  const tabs = hit?.item.tabs;
  if (!hit?.tab || !tabs || tabs.length < 2 || hit.tab.href !== path) return null;
  return (
    <nav aria-label={t(hit.item.label)} className="scrollbar-none -mt-2 mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none]">
      {tabs.map((tab) => {
        const current = tab.href === hit.tab!.href;
        return (
          <Link key={tab.href} href={`${org.base}${tab.href}`} aria-current={current ? 'page' : undefined} data-state={current ? 'active' : 'inactive'} className={TAB_CLASS}>
            {t(tab.label)}
          </Link>
        );
      })}
    </nav>
  );
}
