import type { Permission } from '@tallywork/domain';

/**
 * The Help Center's user manual. Plain language for admins and managers; every step uses the
 * labels people see on screen. Links are paths inside the organization (`/o/:orgId…`); a link
 * shows only to people who can open that page, and a guide whose pages someone cannot open is
 * hidden from them. Keep this in step with the app: the help tests check every link is a real page.
 */
export type HelpCategoryId = 'start' | 'time' | 'people' | 'work' | 'money' | 'reports' | 'settings' | 'faq' | 'tips' | 'troubleshooting';

export const HELP_CATEGORIES: Array<{ id: HelpCategoryId; title: string; description: string }> = [
  { id: 'start', title: 'Getting started', description: 'Your first steps: setting up the organization and getting your team tracking time.' },
  { id: 'time', title: 'Time and timesheets', description: 'Checking, correcting and approving the time your team tracks.' },
  { id: 'people', title: 'People', description: 'Members, teams, schedules, attendance and time off.' },
  { id: 'work', title: 'Clients, projects and tasks', description: 'What people work on, and the breaks planned for each project.' },
  { id: 'money', title: 'Money', description: 'Rates, budgets, expenses, invoices and payroll.' },
  { id: 'reports', title: 'Reports and exports', description: 'Totals for any period, reports you can save, and downloads.' },
  { id: 'settings', title: 'Settings', description: 'Your organization, what is tracked, devices, roles and security.' },
  { id: 'faq', title: 'Frequently asked questions', description: 'Short answers to common questions.' },
  { id: 'tips', title: 'Tips and good habits', description: 'Small things that make WorkPulse easier to run.' },
  { id: 'troubleshooting', title: 'Troubleshooting', description: 'What to do when something does not work as expected.' },
];

export interface HelpLink {
  label: string;
  /** path inside the organization, e.g. "/timesheets/approvals" */
  href: string;
}

export interface HelpArticle {
  id: string;
  category: HelpCategoryId;
  title: string;
  summary: string;
  steps?: string[];
  points?: string[];
  tip?: string;
  links?: HelpLink[];
  /** extra words people might search for */
  keywords?: string[];
  /** shown only to people with one of these permissions (besides being able to open its links) */
  perms?: Permission[];
}

export const HELP_ARTICLES: HelpArticle[] = [
  // ─── Getting started ──────────────────────────────────────────────────────
  {
    id: 'how-workpulse-works',
    category: 'start',
    title: 'How WorkPulse works',
    summary: 'Members track time in the desktop app; you manage everything here.',
    points: [
      'Members install the WorkPulse desktop app on their computer, clock in to a project, take breaks and clock out. When they clock out they write a short end-of-day report.',
      'Their time arrives here automatically, even if they were offline for a while.',
      'On this website, admins and managers see who is working, check and approve timesheets, and handle people, projects, invoices and payroll.',
      'Members who only track their own time are sent to the desktop app download page when they sign in here.',
    ],
    keywords: ['desktop app', 'website', 'worker', 'member', 'clock in'],
  },
  {
    id: 'first-steps',
    category: 'start',
    title: 'Set up your organization',
    summary: 'The five steps on the Overview’s “Get started” checklist.',
    steps: [
      'Invite your team: Members › Invite member.',
      'Create a project: Projects › New project, and add the members or teams who work on it.',
      'Set pay and bill rates: Rates › Set pay rate or Set bill rate.',
      'Connect the desktop app: each member installs it and signs in; their computer then appears under Settings › Devices.',
      'Review what is tracked: Settings › Tracking policies.',
    ],
    tip: 'The Overview shows the same checklist and ticks each step off as you go. You can hide it once you are done.',
    links: [
      { label: 'Invite members', href: '/workers' },
      { label: 'Create a project', href: '/projects' },
      { label: 'Set rates', href: '/finance/billing' },
      { label: 'What is tracked', href: '/settings/policies' },
    ],
    keywords: ['setup', 'onboarding', 'checklist', 'begin', 'start'],
  },
  {
    id: 'overview',
    category: 'start',
    title: 'Use and customize the Overview',
    summary: 'Your home page: what needs attention, at a glance.',
    steps: [
      'Open Overview from the top of the menu.',
      'Use All (Team for team managers), Me or Member at the top to choose whose numbers you see. With Member, pick someone from “Choose a member…”.',
      'Click Customize to change the cards: make each one S, M or L, move it up or down, or hide it. Hidden cards can be added back from Hidden widgets.',
      'Click Save layout to keep your changes, Cancel to undo them, or Reset to go back to the default cards.',
    ],
    links: [{ label: 'Go to Overview', href: '' }],
    keywords: ['dashboard', 'home', 'widgets', 'cards', 'customize'],
  },
  {
    id: 'product-tour',
    category: 'start',
    title: 'Take the product tour again',
    summary: 'A one-minute walk through the menu and the main buttons.',
    steps: ['Click Start the tour at the top of this page.', 'Use Next and Previous to move through the steps, or Skip tour to leave at any time.', 'The tour starts by itself only on your very first visit; after that, start it from here whenever you like.'],
    keywords: ['tour', 'walkthrough', 'introduction', 'guide'],
  },

  // ─── Time and timesheets ──────────────────────────────────────────────────
  {
    id: 'approve-timesheets',
    category: 'time',
    title: 'Approve timesheets',
    summary: 'Check submitted timesheets and approve, reject or ask for changes.',
    steps: [
      'Open Timesheets (it opens on Approvals). The Timesheets panel lists Pending sheets first.',
      'To approve several at once, tick them and click Approve.',
      'To look closer, click a row. The timesheet opens with Approve, Reject and Request changes.',
      'Reject and Request changes need a short comment, which the member sees. Request changes sends the timesheet back so they can fix it.',
      'An approved timesheet can be opened again with Reopen if something needs correcting.',
    ],
    tip: 'Flags on a row point to periods worth a closer look: High manual, Under expected, Over expected, Low activity, or Time added after submit.',
    links: [{ label: 'Open Approvals', href: '/timesheets/approvals' }],
    keywords: ['approval', 'approve', 'reject', 'request changes', 'submitted', 'pending'],
    perms: ['timesheets:approve'],
  },
  {
    id: 'manual-time',
    category: 'time',
    title: 'Approve or request manual time',
    summary: 'Time the timer did not capture, such as a meeting away from the computer.',
    steps: [
      'Open Timesheets › Approvals. Requests are in the Manual time requests panel.',
      'Click Approve to add the time to the member’s timesheet, or Reject (a comment is required).',
      'To ask for time yourself, click Request manual time, enter the date and the time worked (as a duration, or a start and end), pick the project, and click Add time.',
    ],
    links: [{ label: 'Open Approvals', href: '/timesheets/approvals' }],
    keywords: ['manual', 'add time', 'missing time', 'request', 'forgot timer'],
  },
  {
    id: 'correct-time',
    category: 'time',
    title: 'Add or correct someone’s time',
    summary: 'Fix a wrong entry, split it, or add time that is missing.',
    steps: [
      'Open Time entries. Use the date, member, client and project filters to find the entry.',
      'Click the ⋯ menu on the entry and choose Edit, Split, Duplicate, View history or Delete.',
      'When editing, change the start, end, project or note, give a reason for the change, and click Save changes.',
      'To add time, click Add time, choose the member, enter the time and project, and click Add time.',
      'To change many entries at once, tick them and choose Mark billable, Mark non-billable or Delete.',
    ],
    tip: 'Every change is kept: View history shows who changed what and why.',
    links: [{ label: 'Open Time entries', href: '/timesheets/all' }],
    keywords: ['edit', 'fix', 'wrong', 'split', 'delete entry', 'history', 'billable'],
    perms: ['time:edit'],
  },
  {
    id: 'team-week',
    category: 'time',
    title: 'See your team’s week',
    summary: 'Everyone’s hours per day, with the week’s total and expected hours.',
    steps: ['Open Timesheets › Team week.', 'Use the arrows to move between weeks, or pick a date.', 'Click a member (or use “Choose a member…”) to open their timesheet underneath, where you can add time or approve it.'],
    tip: 'Expected hours are highlighted when a member’s week is well below them.',
    links: [{ label: 'Open Team week', href: '/timesheets/team' }],
    keywords: ['week', 'hours', 'expected', 'team', 'timesheet'],
  },
  {
    id: 'live',
    category: 'time',
    title: 'See who is working now, and stop a timer',
    summary: 'Live status for everyone you manage.',
    steps: [
      'Open Live. Each member shows as working, idle or offline, with what they are working on.',
      'Click a member to see their activity, or use the ⋯ menu for View activity, View session or Force stop timer.',
      'Force stop ends a timer that was left running. Time already tracked is kept, and the member’s desktop app stops within about a minute.',
      'Click Session history to see past sessions: when each started and ended, and why it ended.',
    ],
    links: [{ label: 'Open Live', href: '/tracking/live' }],
    keywords: ['live', 'working now', 'online', 'force stop', 'running timer', 'session'],
  },
  {
    id: 'activity',
    category: 'time',
    title: 'Review screenshots, apps and websites',
    summary: 'What was worked on, in 10-minute blocks.',
    steps: [
      'Open Activity and choose the Screenshots, Apps or URLs tab.',
      'On Screenshots, pick a day and a member. Each 10-minute block shows the activity level and any screenshots.',
      'Use Activity level and “Only blocks with screenshots” to narrow it down, and click a block to see its screenshots, keyboard and mouse activity, project and task.',
      'On Apps and URLs, pick a date range and group by app or site, member or project.',
    ],
    tip: 'What is collected (screenshots, apps, websites) depends on your tracking policy.',
    links: [{ label: 'Open Activity', href: '/activity' }],
    keywords: ['screenshots', 'apps', 'websites', 'urls', 'activity level', 'monitoring'],
  },
  {
    id: 'eod-reports',
    category: 'time',
    title: 'Read end-of-day reports',
    summary: 'What each person completed, written when they clock out.',
    steps: [
      'Open End-of-day reports. The numbers at the top show how many reports, how many people wrote one, how many marked their work finished, and the time covered.',
      'Choose a date range and, if you like, one member. Reports are grouped by day; use Search reports to find a word in them.',
      'Click Read full report to open the whole report with its project, clock-in and clock-out times and time worked. Use Previous and Next to read the others, Copy report to paste it elsewhere, or View activity for this day.',
      'Set Show to “Finished work only” to see reports where the person marked the task or project as finished.',
    ],
    links: [{ label: 'Open End-of-day reports', href: '/tracking/reports' }],
    keywords: ['eod', 'end of day', 'daily report', 'clock out', 'finished'],
  },

  // ─── People ────────────────────────────────────────────────────────────────
  {
    id: 'invite-member',
    category: 'people',
    title: 'Invite a member',
    summary: 'Add someone to your organization.',
    steps: [
      'Open Members and click Invite member.',
      'Enter their email and choose a role. You can also add their name, their teams (and whether they manage them) and the projects they work on.',
      'Click Send invitation. WorkPulse emails them a link, and also shows the link so you can copy it.',
      'If email is not set up, nothing is sent: copy the link and send it to them yourself.',
    ],
    tip: 'Waiting invitations are listed under Pending invitations, where you can revoke them.',
    links: [{ label: 'Open Members', href: '/workers' }],
    keywords: ['invite', 'add member', 'new user', 'employee', 'invitation', 'role'],
    perms: ['members:manage'],
  },
  {
    id: 'teams',
    category: 'people',
    title: 'Create a team and choose its manager',
    summary: 'Group members so a manager can approve their time.',
    steps: [
      'Open Members › Teams and click New team. Give it a name and click Create team.',
      'In the panel that opens, pick a member under Add member, set their role to Member or Manager, and click Add.',
      'Managers approve the timesheets and time off of their team.',
      'To give a whole team access to a project, open the project’s Members & teams tab.',
    ],
    links: [{ label: 'Open Teams', href: '/teams' }],
    keywords: ['team', 'manager', 'group', 'department'],
    perms: ['teams:manage'],
  },
  {
    id: 'schedules',
    category: 'people',
    title: 'Set working hours and check attendance',
    summary: 'Schedules say when people should work; attendance compares them with what they tracked.',
    steps: [
      'Open Schedules & attendance. On Schedules, click Edit on a member’s row.',
      'Choose the date the schedule starts (Effective from) and the start and end time for each working day, then click Save new version.',
      'Open the Attendance tab to see each day as Present, Late, Absent, On leave, Holiday or Unscheduled.',
    ],
    tip: 'How many minutes late still counts as on time is set under Settings › Time & pay (Late grace period).',
    links: [
      { label: 'Open Schedules', href: '/schedules' },
      { label: 'Open Attendance', href: '/attendance' },
    ],
    keywords: ['schedule', 'shift', 'working hours', 'attendance', 'late', 'absent'],
  },
  {
    id: 'time-off',
    category: 'people',
    title: 'Handle time off',
    summary: 'Requests, approvals, leave policies and holidays.',
    steps: [
      'Open Time off. To ask for time off, click Request time off, choose the policy and dates, and click Send request.',
      'To decide on requests, open the Requests tab and click Approve or Reject (you can tick several and approve them together).',
      'On Policies & holidays, click New policy to create a kind of leave (hours per day, paid or not, approval needed or not), add holidays, or adjust someone’s balance.',
    ],
    links: [{ label: 'Open Time off', href: '/time-off' }],
    keywords: ['leave', 'vacation', 'holiday', 'sick', 'pto', 'balance', 'time off'],
  },

  // ─── Clients, projects and tasks ──────────────────────────────────────────
  {
    id: 'create-project',
    category: 'work',
    title: 'Create a project',
    summary: 'Projects are what people track time to.',
    steps: [
      'Open Projects and click New project.',
      'Enter a name. Optionally pick a client, dates, an estimate and a colour.',
      'Under Members and Teams, choose who can track time to it.',
      'Under Finance, set pay or bill rates for this project, or tick “Not billable project”.',
      'Click Create project. The project page opens, where you can add tasks, a budget and documents.',
    ],
    links: [{ label: 'Open Projects', href: '/projects' }],
    keywords: ['project', 'new project', 'assign', 'members'],
    perms: ['projects:manage'],
  },
  {
    id: 'project-breaks',
    category: 'work',
    title: 'Plan breaks for a project (coffee, lunch…)',
    summary: 'Members see these as break buttons in the desktop app, with a reminder at the time.',
    steps: [
      'First create the kinds of breaks under Settings › Time & pay › Break types (for example Coffee, 15 minutes, paid; Lunch, 60 minutes, unpaid).',
      'Open the project (or New project) and find Breaks. Click Add break.',
      'Choose the break type, and optionally a time (such as 12:00) and a length. Leave the time empty for “any time”, or the length empty to use the break type’s maximum.',
      'Save the project. Members on it now see one-tap buttons for these breaks after clocking in, and a reminder when a break is due.',
    ],
    links: [
      { label: 'Break types', href: '/settings/time' },
      { label: 'Open Projects', href: '/projects' },
    ],
    keywords: ['break', 'coffee', 'lunch', 'rest', 'reminder', 'clock in'],
    perms: ['projects:manage'],
  },
  {
    id: 'tasks',
    category: 'work',
    title: 'Add tasks to a project',
    summary: 'Tasks let people track time to a specific piece of work.',
    steps: ['Open the project and its Tasks tab (or open Tasks in the menu), then click New task.', 'Choose the project, enter a title, and optionally a due date, estimate and who it is assigned to.', 'Click Create task. Assigned members see it in the desktop app.'],
    links: [{ label: 'Open Tasks', href: '/tasks' }],
    keywords: ['task', 'to do', 'assign', 'due date'],
  },
  {
    id: 'clients',
    category: 'work',
    title: 'Add a client and share a client portal',
    summary: 'Clients are who you bill; a portal lets them see progress.',
    steps: [
      'Open Clients and click New client. Only the company or client name is required; contact details, currency and rates are optional. Click Create client.',
      'To share progress, use the ⋯ menu on the client and choose Client portal.',
      'Turn the portal on, choose what it shows (hours, task progress, activity, screenshots) and which projects, then invite people by email. Use Preview as client to check it.',
    ],
    links: [{ label: 'Open Clients', href: '/clients' }],
    keywords: ['client', 'customer', 'portal', 'share'],
    perms: ['clients:manage'],
  },

  // ─── Money ─────────────────────────────────────────────────────────────────
  {
    id: 'rates',
    category: 'money',
    title: 'Set pay and bill rates',
    summary: 'What you pay members and what you charge clients, per hour.',
    steps: [
      'Open Rates and click Set pay rate or Set bill rate.',
      'Choose what the rate applies to: the whole organization, a client, a project, a member, or a member on one project.',
      'Enter the rate per hour and the date it starts, then click Save rate.',
    ],
    points: ['The most specific rate wins: a rate for one member on one project beats a project rate, which beats the organization’s rate.', 'You can also set today’s rate directly on a member, client or project.'],
    links: [{ label: 'Open Rates', href: '/finance/billing' }],
    keywords: ['rate', 'pay rate', 'bill rate', 'hourly', 'wage', 'price'],
  },
  {
    id: 'budgets',
    category: 'money',
    title: 'Set a budget',
    summary: 'Get a warning before a project or client runs out of hours or money.',
    steps: ['Open Budgets and click Set budget.', 'Choose the project or client, Hours or Money, and the amount. Choose whether it is for the whole project or resets each month, and when to warn you.', 'Click Save budget. Budgets turn to warning, then exceeded, as time is logged.'],
    links: [{ label: 'Open Budgets', href: '/finance/budgets' }],
    keywords: ['budget', 'limit', 'overrun', 'estimate'],
    perms: ['budgets:manage'],
  },
  {
    id: 'expenses',
    category: 'money',
    title: 'Submit and approve expenses',
    summary: 'Costs such as travel or software, with receipts.',
    steps: [
      'Open Expenses and click New expense. Enter the category, date and amount, attach a receipt if you have one, and click Submit expense.',
      'To decide, click Approve or Reject on a submitted expense.',
      'Once you have paid someone back, click Reimburse.',
    ],
    links: [{ label: 'Open Expenses', href: '/finance/expenses' }],
    keywords: ['expense', 'receipt', 'reimburse', 'travel', 'cost'],
  },
  {
    id: 'invoice',
    category: 'money',
    title: 'Create and send an invoice',
    summary: 'Bill a client for approved time and expenses.',
    steps: [
      'Open Invoices and click New invoice.',
      'Choose the client and the period, how to group the time, and the tax rate. Click Preview lines.',
      'Add any extra lines, then set the issue and due dates and notes.',
      'Click Review, then Create draft invoice.',
      'On the invoice, click Send invoice (or Mark as sent if the client has no email). Download PDF gives you a copy.',
    ],
    tip: 'Only approved, billable time is invoiced, so approve timesheets first.',
    links: [{ label: 'Open Invoices', href: '/finance/invoices' }],
    keywords: ['invoice', 'bill', 'billing', 'client', 'pdf', 'send'],
    perms: ['invoices:manage'],
  },
  {
    id: 'payments',
    category: 'money',
    title: 'Record a payment',
    summary: 'Mark an invoice as paid when the money comes in.',
    steps: ['Open the invoice and click Record payment (or use Invoices › Payments received).', 'Enter the amount and the date it was received, and optionally the method and a reference.', 'Save it. The invoice’s balance goes down, and it shows as paid once nothing is left.'],
    links: [{ label: 'Payments received', href: '/finance/invoices/payments' }],
    keywords: ['payment', 'paid', 'received', 'balance'],
    perms: ['payments:manage'],
  },
  {
    id: 'payroll',
    category: 'money',
    title: 'Run payroll',
    summary: 'Pay members for approved time and paid time off, and publish pay stubs.',
    steps: [
      'Open Payroll and click Run payroll. Choose the pay group and period, and click Create draft.',
      'Check each person’s pay. Use Adjust to add a bonus or a deduction, and Recalculate after approving late timesheets.',
      'Click Finalize. Amounts are locked and each member’s pay stub is published.',
      'After paying, click Mark as paid.',
    ],
    points: ['The Owed tab shows what members are owed for any dates before you run payroll: an estimate from tracked time, and the amount from approved time.', 'Pay groups set how often a group of members is paid and in which currency.'],
    links: [
      { label: 'Open Payroll', href: '/finance/payroll' },
      { label: 'See what is owed', href: '/finance/payroll?tab=owed' },
    ],
    keywords: ['payroll', 'pay', 'salary', 'wages', 'pay stub', 'owed', 'bonus', 'deduction'],
  },

  // ─── Reports and exports ──────────────────────────────────────────────────
  {
    id: 'summary',
    category: 'reports',
    title: 'See totals for a period',
    summary: 'Time, estimated pay and billable time, by day, client, project and person.',
    steps: ['Open Summary.', 'Choose Daily, Weekly, Fortnightly or Monthly, and use the arrows to move between periods (Current brings you back).', 'Click a person to open their profile, or Export CSV to download the people table.'],
    links: [{ label: 'Open Summary', href: '/insights' }],
    keywords: ['summary', 'insights', 'totals', 'hours', 'chart'],
  },
  {
    id: 'reports',
    category: 'reports',
    title: 'Run, save and schedule a report',
    summary: 'Answers to questions like “where did time go?” or “who was late?”.',
    steps: [
      'Open Report library and click a report.',
      'Choose the dates and filters (members, teams, projects, clients) and how to group the results.',
      'Click Save report to keep it. Turn on “Email on a schedule” to have it sent to people automatically.',
      'Click Export to download it as CSV, Excel or PDF.',
    ],
    links: [{ label: 'Open Report library', href: '/reports' }],
    keywords: ['report', 'export', 'schedule', 'email', 'excel', 'csv', 'pdf'],
  },
  {
    id: 'export-lists',
    category: 'reports',
    title: 'Download a list (invoices, expenses, budgets…)',
    summary: 'Export exactly what a page shows.',
    steps: [
      'Open Invoices, Payments received, Expenses or Payroll › Owed.',
      'Choose a period in the date range (for example This month). Export stays greyed out until you do.',
      'Click Export and choose CSV, Excel or PDF.',
    ],
    tip: 'On Budgets, Export gives each budget’s status today, so no period is needed.',
    links: [
      { label: 'Invoices', href: '/finance/invoices' },
      { label: 'Expenses', href: '/finance/expenses' },
    ],
    keywords: ['export', 'download', 'csv', 'excel', 'pdf', 'spreadsheet'],
  },

  // ─── Settings ──────────────────────────────────────────────────────────────
  {
    id: 'organization-settings',
    category: 'settings',
    title: 'Change organization, pay period and timesheet rules',
    summary: 'Name, time zone and currency; pay periods, locks and reminders.',
    steps: [
      'Open Settings › Organization for the name, time zone, week start, currency and the company details printed on invoices.',
      'Open Settings › Time & pay for the pay period, working hours per day, timesheet locks and minimums, missing-time reminders, the late grace period, overtime, time types and break types.',
      'Each page has its own Save changes button.',
    ],
    links: [
      { label: 'Organization', href: '/settings' },
      { label: 'Time & pay', href: '/settings/time' },
    ],
    keywords: ['settings', 'organization', 'time zone', 'currency', 'pay period', 'lock', 'overtime', 'reminder'],
    perms: ['org:update'],
  },
  {
    id: 'tracking-policies',
    category: 'settings',
    title: 'Choose what the desktop app tracks',
    summary: 'Activity, idle time, screenshots, apps, websites and time limits.',
    steps: [
      'Open Settings › Tracking policies.',
      'Under Policy scope, choose the whole organization, one team or one member.',
      'Turn each kind of tracking on or off and adjust its options (for example how many screenshots, and whether they are blurred).',
      'Click Save policy. Members are told that their tracking settings changed, and the desktop app follows the new settings.',
    ],
    tip: 'A team or member setting overrides the organization’s; Reset to inherited removes the override.',
    links: [{ label: 'Open Tracking policies', href: '/settings/policies' }],
    keywords: ['policy', 'screenshots', 'blur', 'idle', 'monitoring', 'privacy', 'limits'],
  },
  {
    id: 'devices',
    category: 'settings',
    title: 'Approve, sign out or remove a computer',
    summary: 'The computers where members use the desktop app.',
    steps: [
      'Open Settings › Devices.',
      'Use the ⋯ menu on a device: Approve device (only needed when device approval is required), Require sign-in again, or Revoke device.',
      'Require sign-in again keeps the device but asks the member to sign in again. Revoke disconnects it for good; time already synced is kept.',
    ],
    links: [{ label: 'Open Devices', href: '/devices' }],
    keywords: ['device', 'computer', 'laptop', 'approve', 'revoke', 'lost'],
  },
  {
    id: 'roles',
    category: 'settings',
    title: 'Create a custom role',
    summary: 'Decide exactly what a group of people can see and do.',
    steps: [
      'Open Settings › Roles & permissions and click Create custom role.',
      'Give it a name and, to save time, start from an existing role.',
      'For each permission, choose whether it covers their own data, assigned projects, their team, the whole organization, or nothing.',
      'Click Create role, then give it to people from their member profile.',
    ],
    links: [{ label: 'Open Roles', href: '/settings/roles' }],
    keywords: ['role', 'permission', 'access', 'admin', 'manager'],
  },
  {
    id: 'security',
    category: 'settings',
    title: 'Security and sign-in',
    summary: 'Two-factor sign-in, device approval, allowed networks and data retention.',
    points: [
      'Settings › Security & retention: require two-factor sign-in for admins or everyone, set how long sign-ins last, require approval for new devices, limit sign-in to your networks, and choose how long data is kept.',
      'Settings › Access review: who has which role, who has not set up two-factor sign-in, and active API keys.',
      'Settings › Audit log: every change made in the organization, with who made it and when.',
    ],
    links: [
      { label: 'Security & retention', href: '/settings/security' },
      { label: 'Audit log', href: '/settings/audit' },
    ],
    keywords: ['security', 'two-factor', '2fa', 'mfa', 'password', 'audit', 'retention', 'ip'],
  },
  {
    id: 'screenshot-retention',
    category: 'settings',
    title: 'Keep screenshots for a set time',
    summary: 'Delete old screenshots automatically so storage does not keep growing.',
    points: [
      'Settings › Screenshot retention: choose how long screenshots are kept (30 days to start), and when expired ones are deleted: every day or once a week, at a time in your time zone (02:00 to start).',
      'Before the first deletion, select Preview cleanup. It shows how many screenshots would go and about how much storage that frees, and deletes nothing. If it looks right, select Approve cleanup.',
      'From then on the cleanup runs on its own. Run cleanup now starts one straight away. Choosing a shorter period later needs a new preview and approval.',
      'Only screenshots and their files are deleted. Time, timesheets, invoices and activity stay. Deleted screenshots cannot be restored.',
      'Cleanup history lists every run: how many were deleted, how much storage was freed, and anything that could not be deleted (it is tried again later).',
    ],
    links: [{ label: 'Screenshot retention', href: '/settings/screenshot-retention' }],
    keywords: ['screenshot', 'retention', 'cleanup', 'delete', 'storage', 'space', 'old'],
  },

  // ─── FAQ ───────────────────────────────────────────────────────────────────
  {
    id: 'faq-members-website',
    category: 'faq',
    title: 'Why are members sent to a download page when they sign in here?',
    summary: 'Members who only track their own time use the desktop app.',
    points: ['This website is for admins and managers. Members track time, take breaks, submit timesheets and see their pay stubs in the desktop app.', 'The download page offers the installer for their computer and simple steps to sign in.'],
    keywords: ['worker', 'download', 'cannot sign in', 'desktop app'],
  },
  {
    id: 'faq-menu-missing',
    category: 'faq',
    title: 'Why can’t I see a page someone else can?',
    summary: 'Your menu only shows what your role allows.',
    points: ['Each role decides what you can open; team managers, for example, see their own team but not payroll.', 'If you need more access, ask an admin to change your role or create a custom one.'],
    keywords: ['missing', 'permission', 'access denied', 'role', 'menu'],
  },
  {
    id: 'faq-approved-change',
    category: 'faq',
    title: 'Can approved time still be changed?',
    summary: 'Yes, by reopening the timesheet.',
    points: ['Open the timesheet and click Reopen, then correct it and approve it again.', 'If payroll for that period was already finalized, the change is paid in the next payroll.'],
    keywords: ['approved', 'reopen', 'change', 'locked', 'payroll'],
  },
  {
    id: 'faq-offline',
    category: 'faq',
    title: 'What happens if a member’s computer is offline?',
    summary: 'Nothing is lost.',
    points: ['The desktop app keeps tracking and saves the time on the computer, then sends it as soon as it is back online.', 'On Live they may show as offline in the meantime.'],
    keywords: ['offline', 'internet', 'lost time', 'sync'],
  },
  {
    id: 'faq-screenshots-privacy',
    category: 'faq',
    title: 'Are keystrokes recorded?',
    summary: 'No. Only how much the keyboard and mouse were used.',
    points: ['WorkPulse counts keyboard and mouse activity to show an activity level; it never records what was typed.', 'Screenshots, apps and websites are only collected when your tracking policy turns them on, and screenshots can be blurred.'],
    keywords: ['privacy', 'keystrokes', 'keylogger', 'screenshots', 'monitoring'],
  },

  // ─── Tips ──────────────────────────────────────────────────────────────────
  {
    id: 'tips',
    category: 'tips',
    title: 'Tips for running WorkPulse smoothly',
    summary: 'A few habits that save time each week.',
    points: [
      'Approve timesheets before invoicing or running payroll: both use approved time.',
      'Plan breaks on each project so members can take them with one tap, and get reminded on time.',
      'Use end-of-day reports to see progress without asking everyone for updates.',
      'Save the reports you run often, and schedule them to arrive by email.',
      'Group members into teams with a manager, so approvals don’t all fall on one person.',
      'Check Live at the end of the day for timers left running.',
    ],
    keywords: ['tips', 'best practices', 'advice'],
  },

  // ─── Troubleshooting ──────────────────────────────────────────────────────
  {
    id: 'trouble-timer-running',
    category: 'troubleshooting',
    title: 'A member forgot to stop their timer',
    summary: 'Stop it from Live, then correct the time.',
    steps: ['Open Live, find the member and choose Force stop timer from the ⋯ menu.', 'If extra time was recorded, open Time entries and edit or split the entry.'],
    links: [{ label: 'Open Live', href: '/tracking/live' }],
    keywords: ['timer running', 'forgot', 'overnight', 'force stop'],
  },
  {
    id: 'trouble-missing-time',
    category: 'troubleshooting',
    title: 'A member’s time is missing',
    summary: 'Check the device, then add the time if needed.',
    steps: [
      'Ask whether their desktop app shows they are online; time tracked offline arrives once they reconnect.',
      'Check Settings › Devices: if their computer is waiting for approval or was revoked, approve it or ask them to sign in again.',
      'For time they really did not track, ask them to request manual time, or add it yourself from Time entries.',
    ],
    links: [
      { label: 'Open Devices', href: '/devices' },
      { label: 'Open Time entries', href: '/timesheets/all' },
    ],
    keywords: ['missing time', 'no time', 'not syncing', 'device'],
  },
  {
    id: 'trouble-cannot-approve',
    category: 'troubleshooting',
    title: 'The Approve button is greyed out',
    summary: 'Time was added after the timesheet was submitted.',
    steps: ['Click Request changes so the member can review and resubmit it.', 'Once they resubmit, Approve works again.'],
    keywords: ['approve disabled', 'greyed out', 'cannot approve'],
  },
  {
    id: 'trouble-export',
    category: 'troubleshooting',
    title: 'Export is greyed out',
    summary: 'Pick a period first.',
    steps: ['Choose a period in the date range at the top of the list (for example This month or Last month).', 'Export then becomes available.'],
    keywords: ['export disabled', 'download', 'greyed out'],
  },
  {
    id: 'trouble-desktop-update',
    category: 'troubleshooting',
    title: 'A member doesn’t have the latest desktop app',
    summary: 'Updates install when the app is quit.',
    points: ['The desktop app checks for updates every few hours and downloads them in the background.', 'The update installs when the member quits the app from its icon in the system tray (closing the window leaves it running).'],
    keywords: ['update', 'version', 'old version', 'desktop app'],
  },
];

/** What each menu item is for, keyed by its menu label. */
export const NAV_GUIDE: Record<string, string> = {
  'nav.item.overview': 'Your home page: what needs attention, with cards you can customize.',
  'nav.item.timeEntries': 'Every time entry, with filters. Add, correct, split or delete time.',
  'nav.item.timesheets': 'Approvals (timesheets and manual time waiting for you) and Team week (everyone’s hours this week).',
  'nav.item.live': 'Who is working right now. Stop a timer or see past sessions.',
  'nav.item.activity': 'Screenshots, apps and websites, in 10-minute blocks.',
  'nav.item.eodReports': 'What each person completed, written when they clock out.',
  'nav.item.members': 'Everyone in the organization, invitations, and teams.',
  'nav.item.schedulesAttendance': 'Working hours for each member, and who was present, late or absent.',
  'nav.item.timeOff': 'Time off requests, the leave calendar, policies and holidays.',
  'nav.item.clients': 'Who you work for, their client portals and invoices.',
  'nav.item.projects': 'What people track time to, with tasks, budgets, documents and planned breaks.',
  'nav.item.tasks': 'Tasks across all projects.',
  'nav.item.rates': 'Hourly pay and bill rates.',
  'nav.item.budgets': 'Hour and money budgets for projects and clients.',
  'nav.item.expenses': 'Expenses with receipts, their approval and reimbursement.',
  'nav.item.invoices': 'Invoices to clients, and payments received.',
  'nav.item.payroll': 'Payroll runs, what members are owed, and pay groups.',
  'nav.item.summary': 'Totals of time and money for any period.',
  'nav.item.reportLibrary': 'Reports you can filter, save, schedule and download.',
  'nav.item.settings': 'Organization, time & pay, tracking, devices, roles, security, integrations and the audit log.',
  'nav.item.help': 'This guide, and the product tour.',
};
