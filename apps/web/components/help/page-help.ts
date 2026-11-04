import type { Permission } from '@tallywork/domain';
import { HELP_ARTICLES, type HelpArticle } from './content';

/**
 * The guide for a page, for the "Help" link in the top bar (one place on every page, phone included).
 * Some pages name their guide; otherwise it is the first guide that links to the page. A guide limited
 * to some permissions is offered only to people who have one of them.
 */
export const PAGE_GUIDE: Record<string, string> = {
  '/finance/billing': 'rates',
  '/finance/payroll': 'payroll',
  '/reports': 'reports',
  '/settings/policies': 'tracking-policies',
  '/settings/screenshot-retention': 'screenshot-retention',
  '/tracking/reports': 'eod-reports',
  '/timesheets/not-added': 'time-not-added',
  '/timesheets/approvals': 'approve-timesheets',
};

export function guideFor(path: string, can: (p: Permission) => boolean, articles: HelpArticle[] = HELP_ARTICLES): HelpArticle | null {
  const usable = (a: HelpArticle) => !a.perms || a.perms.some((p) => can(p));
  // Approvals for someone who handles only manual time (no timesheets to approve): the manual time guide.
  const named = path === '/timesheets/approvals' && !can('timesheets:approve') ? 'manual-time' : PAGE_GUIDE[path];
  if (named) {
    const a = articles.find((x) => x.id === named);
    if (a && usable(a)) return a;
  }
  return articles.find((a) => usable(a) && a.links?.some((l) => l.href === path)) ?? null;
}
