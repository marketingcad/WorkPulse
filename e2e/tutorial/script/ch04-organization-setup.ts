import type { Chapter } from '../scenes';

export const ch04: Chapter = {
  n: 4,
  title: 'Set up your organization',
  goal: 'Configure the organization, timesheet periods and rules, break types, what the desktop app tracks, and roles.',
  scenes: [
    {
      id: '04.1',
      title: 'Organization settings',
      persona: 'admin',
      app: 'web',
      screen: 'Settings › Organization: the General panel (name, time zone, week start, currency, duration format) and the Company profile panel.',
      actions: ['Click "Settings" in the sidebar.', 'Point at Organization name, Time zone, Week starts on, Currency and Duration format.', 'Scroll to "Company profile" and point at the logo, Tax ID and Full address.', 'Point at "Save changes".'],
      narration:
        'Now let us set up the organization. Open Settings. The tabs across the top hold every setting, and you only see the ones your role allows. On the Organization tab, the General panel sets your company name, time zone, the day your week starts, your currency, and how durations are shown. The Company profile below holds your logo, tax ID, address and contact details. They appear on your invoices and pay stubs. After a change, click Save changes.',
      overlays: ['Callout: "Logo and address appear on invoices and pay stubs"'],
      focus: ['Zoom to the Settings tabs.', 'Zoom to the General panel.'],
      transition: 'Cut to the Time & pay tab.',
    },
    {
      id: '04.2',
      title: 'Time & pay: periods, rules, overtime and break types',
      persona: 'admin',
      app: 'web',
      screen: 'Settings › Time & pay: Timesheet period, Timesheet rules, Overtime, Time types and Break types; the "New break type" dialog.',
      actions: [
        'Click the "Time & pay" tab.',
        'Point at "Timesheet period" and "Timesheet rules".',
        'Scroll to "Overtime" and "Time types".',
        'Scroll to "Break types" and click "Add break type".',
        'Type "Coffee", switch on "Paid break", type 15 in "Maximum length (minutes)", click "Add break type".',
        'Click "Add break type" again: "Lunch", unpaid, 60 minutes.',
      ],
      narration:
        'The Time and pay tab controls how time becomes pay. The timesheet period sets how often members submit their time, for example every week. Timesheet rules can lock old time so it cannot be changed, set minimum hours, and remind people about missing time. Below are the overtime rules and your time types, such as regular or overtime, each with its own pay and bill multiplier. Break types define the breaks your people can take. Let us add a coffee break: name it Coffee, make it a paid break, with a maximum of fifteen minutes. And a lunch break: unpaid, up to sixty minutes. We will plan these breaks on a project in a moment.',
      overlays: ['Callout: "Paid breaks count as paid, non-billable time"'],
      focus: ['Zoom to "Timesheet period".', 'Zoom to the "New break type" dialog while typing.'],
      transition: 'Cut to the Tracking policies tab.',
    },
    {
      id: '04.3',
      title: 'Choose what the desktop app tracks',
      persona: 'admin',
      app: 'web',
      screen: 'Settings › Tracking policies: the organization default with sections for Tracking, Activity, Idle, Screenshots, Apps and URLs; then the Team scope for one team.',
      actions: [
        'Click the "Tracking policies" tab.',
        'Scroll through the Activity, Idle, Screenshots, Apps and URLs sections.',
        'Click "Team" in "Policy scope" and choose "Client Success".',
        'Point at the screenshot blur setting that this team overrides, and at "Reset to inherited".',
      ],
      narration:
        'Tracking policies decide what the desktop app records. The organization default applies to everyone. Activity counts keyboard and mouse use, never the keys themselves. Idle detection asks people what to do with time when they step away. Screenshots can be switched on, taken a set number of times every ten minutes, and blurred. Apps and URLs record which applications and websites are used. You can override any setting for a team or for one member. Here, the Client Success team has its screenshots blurred. An overridden setting shows Reset to inherited. When you save, the affected members are notified, and each member can always see what is monitored.',
      overlays: ['Callout: "Keystrokes are counted, never recorded"', 'Callout: "Members are notified of changes"'],
      focus: ['Highlight the "Screenshots" section.', 'Zoom to the "Policy scope" switch.'],
      transition: 'Cut to the Roles & permissions tab.',
    },
    {
      id: '04.4',
      title: 'Roles and permissions',
      persona: 'admin',
      app: 'web',
      screen: 'Settings › Roles & permissions: the permission matrix for the built-in roles, and the "Create custom role" dialog.',
      actions: [
        'Click the "Roles & permissions" tab.',
        'Scroll the permission matrix.',
        'Click "Create custom role".',
        'Type "Project Coordinator" in Name, choose "Team Manager" in "Start from", add a description.',
        'Click "Create role".',
      ],
      narration:
        'Roles control who can see and do what. WorkPulse comes with built-in roles: System Admin for full access, Team Manager for running teams and projects without the money settings, and Worker for people who track time. The matrix shows every permission for every role. If you need something in between, create a custom role. Give it a name, start from an existing role, and then adjust its permissions. Each permission can apply to the person themselves, their assigned projects, their team, or the whole organization.',
      overlays: ['Callout: "Scopes: own · assigned · team · organization"'],
      focus: ['Zoom to the permission matrix.', 'Zoom to the "Create custom role" dialog.'],
      transition: 'Wipe to a chapter card: "Chapter 5 — Add your people".',
    },
  ],
};
