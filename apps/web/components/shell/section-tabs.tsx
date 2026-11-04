'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { TAB_CLASS } from '@tallywork/ui';
import { t } from '@/lib/i18n';
import { useOrg } from '@/lib/org';
import { activeNav, filterNav, type NavTab } from './nav';

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
  if (tabs.some((tab) => tab.group)) return <GroupedTabs label={t(hit.item.label)} tabs={tabs} current={hit.tab.href} />;
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

/**
 * Many sections (Settings): every one visible at once under its topic, instead of a row of tabs that
 * scrolls out of sight. On phones, one labelled list of the same sections, grouped the same way.
 */
function GroupedTabs({ label, tabs, current }: { label: string; tabs: NavTab[]; current: string }) {
  const org = useOrg();
  const router = useRouter();
  const groups = [...new Set(tabs.map((tab) => tab.group ?? ''))].map((g) => ({ key: g, tabs: tabs.filter((tab) => (tab.group ?? '') === g) }));
  return (
    <nav aria-label={label} className="-mt-2 mb-5 border-b border-border pb-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-text-muted md:hidden">
        {t('nav.settings.section')}
        <select value={current} onChange={(e) => router.push(`${org.base}${e.target.value}`)} className="h-9 rounded-sm border border-border bg-surface px-2 text-sm text-text focus:border-interactive focus:outline-none">
          {groups.map((g) => (
            <optgroup key={g.key} label={g.key ? t(g.key) : label}>
              {g.tabs.map((tab) => (
                <option key={tab.href} value={tab.href}>
                  {t(tab.label)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="hidden flex-wrap gap-x-6 gap-y-3 md:flex">
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.key ? t(g.key) : label} className="flex flex-col gap-1">
            {g.key && <span className="px-1 text-2xs font-semibold uppercase tracking-wide text-text-faint" aria-hidden>{t(g.key)}</span>}
            <div className="flex flex-wrap gap-1">
              {g.tabs.map((tab) => (
                <Link
                  key={tab.href}
                  href={`${org.base}${tab.href}`}
                  aria-current={tab.href === current ? 'page' : undefined}
                  className={`rounded-sm px-2.5 py-1 text-sm transition-colors ${tab.href === current ? 'bg-interactive-soft font-semibold text-interactive' : 'text-text-muted hover:bg-surface-muted hover:text-text'}`}
                >
                  {t(tab.label)}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}
