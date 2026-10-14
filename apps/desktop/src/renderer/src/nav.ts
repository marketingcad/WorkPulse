import type { Page, View } from './lib';

/**
 * The worker app's primary navigation, as pure data (no React, no icons) so it can be unit-tested.
 * Five groups for the worker's daily job: the daily actions come first (Home, Track, Timesheet,
 * Time off); read-only and personal screens collapse into "Me". A group with `tabs` opens its first
 * tab and shows a secondary tab bar. Every screen the app had before is still reachable here.
 */
export type NavTab = { v: View; label: string };
export type NavGroup = { v: Page; label: string; icon: string; tabs?: NavTab[] };

export const NAV_GROUPS: NavGroup[] = [
  { v: 'home', label: 'Home', icon: 'home' },
  {
    v: 'projects',
    label: 'Track',
    icon: 'track',
    tabs: [
      { v: 'projects', label: 'Projects' },
      { v: 'tasks', label: 'Tasks' },
      { v: 'tracking', label: 'Sessions' },
    ],
  },
  {
    v: 'timesheet',
    label: 'Timesheet',
    icon: 'timesheet',
    tabs: [
      { v: 'timesheet', label: 'Timesheet' },
      { v: 'activity', label: 'Activity' },
      { v: 'reports', label: 'Reports' },
    ],
  },
  { v: 'timeoff', label: 'Time off', icon: 'timeoff' },
  {
    v: 'schedule',
    label: 'Me',
    icon: 'me',
    tabs: [
      { v: 'schedule', label: 'Schedule' },
      { v: 'paystubs', label: 'Pay stubs' },
      { v: 'monitoring', label: 'What is monitored' },
      { v: 'settings', label: 'Settings' },
    ],
  },
];

/** The nav group each view belongs to (highlighted while any of its screens is open). */
export const GROUP_OF: Record<View, Page> = {
  home: 'home',
  projects: 'projects',
  tasks: 'projects',
  tracking: 'projects',
  manual: 'projects',
  timesheet: 'timesheet',
  activity: 'timesheet',
  reports: 'timesheet',
  timeoff: 'timeoff',
  schedule: 'schedule',
  paystubs: 'schedule',
  monitoring: 'schedule',
  settings: 'schedule',
};

/** The group that owns a view, for highlighting the rail and choosing the sub-tab bar. */
export function groupFor(view: View): NavGroup {
  const v = GROUP_OF[view];
  // GROUP_OF is exhaustive over View and every value is a group's `v`, so this always resolves.
  return NAV_GROUPS.find((g) => g.v === v) ?? NAV_GROUPS[0]!;
}
