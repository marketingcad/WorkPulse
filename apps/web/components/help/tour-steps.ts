/**
 * The product tour: a short walk through the parts of the web app that every admin or manager
 * uses. Each step points at an element marked `data-tour="…"`. A step whose element is not on
 * screen (a menu group the person cannot open, the sidebar on a phone) is left out, so the same
 * list works for every role and screen size.
 */
export interface TourStep {
  id: string;
  /** `data-tour` value of the element to highlight; none = a centred message */
  target?: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to WorkPulse',
    body: 'A quick look around: where things are and where to get help. It takes about a minute, and you can skip it at any time.',
  },
  {
    id: 'menu',
    target: 'nav-menu',
    title: 'The menu',
    body: 'Tap here to open the menu. Every page is in it, grouped by topic, with Settings and Help at the bottom.',
  },
  {
    id: 'time',
    target: 'nav.group.time',
    title: 'Time',
    body: 'Everyone’s time: time entries, timesheets waiting for approval, who is working right now, screenshots and apps, and end-of-day reports.',
  },
  {
    id: 'people',
    target: 'nav.group.people',
    title: 'People',
    body: 'Invite members, organise them into teams, plan schedules, check attendance and handle time off.',
  },
  {
    id: 'work',
    target: 'nav.group.work',
    title: 'Work',
    body: 'The clients you work for, their projects (with planned breaks) and the tasks people track time against.',
  },
  {
    id: 'money',
    target: 'nav.group.money',
    title: 'Money',
    body: 'Budgets and expenses, and, depending on your role, pay and bill rates, invoices and payroll.',
  },
  {
    id: 'reports',
    target: 'nav.group.reports',
    title: 'Reports',
    body: 'A summary of time and money for any period, and a library of reports you can filter, save and download.',
  },
  {
    id: 'settings',
    target: 'nav.item.settings',
    title: 'Settings',
    body: 'Your organization, pay periods and timesheet rules, what the desktop app tracks, devices, roles and security.',
  },
  {
    id: 'customize',
    target: 'overview-customize',
    title: 'Your overview',
    body: 'This page shows what needs your attention. Use Customize to choose, order and size its cards.',
  },
  {
    id: 'notifications',
    target: 'notifications',
    title: 'Notifications',
    body: 'Timesheets to approve, time off requests, finished exports and other updates appear here.',
  },
  {
    id: 'account',
    target: 'account-menu',
    title: 'Your account',
    body: 'Your profile and devices, your own timesheet and pay stubs, and sign out.',
  },
  {
    id: 'help',
    target: 'nav.item.help',
    title: 'Help is always here',
    body: 'Step-by-step guides, answers to common questions and fixes for common problems. You can restart this tour from Help.',
  },
];

/** The steps to show: centred steps always, others only when their element is on screen. */
export function visibleSteps(steps: TourStep[], isOnScreen: (target: string) => boolean): TourStep[] {
  return steps.filter((s) => !s.target || isOnScreen(s.target));
}

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where the step's card goes: to the right of the highlighted element when there is room (the
 * sidebar), otherwise below, above or to the left, and always inside the window with a margin.
 * Without an element the card is centred.
 */
export function placeCard(target: Box | null, card: { width: number; height: number }, view: { width: number; height: number }, gap = 12, margin = 12): { top: number; left: number; side: 'right' | 'bottom' | 'top' | 'left' | 'center' } {
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));
  if (!target) return { top: clamp((view.height - card.height) / 2, margin, view.height - card.height - margin), left: clamp((view.width - card.width) / 2, margin, view.width - card.width - margin), side: 'center' };
  const fitsX = (x: number) => x >= margin && x + card.width <= view.width - margin;
  const fitsY = (y: number) => y >= margin && y + card.height <= view.height - margin;
  const alignY = clamp(target.top + target.height / 2 - card.height / 2, margin, view.height - card.height - margin);
  const alignX = clamp(target.left + target.width / 2 - card.width / 2, margin, view.width - card.width - margin);
  const right = target.left + target.width + gap;
  if (fitsX(right)) return { top: alignY, left: right, side: 'right' };
  const below = target.top + target.height + gap;
  if (fitsY(below)) return { top: below, left: alignX, side: 'bottom' };
  const above = target.top - gap - card.height;
  if (fitsY(above)) return { top: above, left: alignX, side: 'top' };
  const left = target.left - gap - card.width;
  if (fitsX(left)) return { top: alignY, left, side: 'left' };
  return { top: clamp(below, margin, view.height - card.height - margin), left: alignX, side: 'bottom' };
}
