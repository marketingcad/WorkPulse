import type { Chapter } from '../scenes';

export const ch12: Chapter = {
  n: 12,
  title: 'Reports',
  goal: 'Read the Summary, run a report from the library, export it, and save it to arrive by email on a schedule.',
  scenes: [
    {
      id: '12.1',
      title: 'Summary',
      persona: 'admin',
      app: 'web',
      screen: 'Reports › Summary: time, pay, billing and activity totals for the month, hours per day, by client, by project, and per person.',
      actions: [
        'Open Reports › Summary.',
        'Point at Time logged, Est. pay, Billable time, Est. billable, Activity and Days off.',
        'Click "Weekly" in the period switch, then "Previous period".',
        'Scroll to "Hours by client", "Hours by project" and "People".',
        'Point at "Export CSV".',
      ],
      narration:
        'For a quick answer, open Reports, then Summary. It shows the time logged, estimated pay, billable time and estimated billing for a period, together with average activity and days off. Switch between daily, weekly, fortnightly and monthly periods, and step back with the arrows. Below are the hours per day, by client, and by project, and a table with every person\'s totals. Members who open Summary see only their own time, and never any money.',
      overlays: ['Callout: "Members see only their own time"'],
      focus: ['Zoom to the totals.', 'Zoom to the People table.'],
      transition: 'Cut to the Report library.',
    },
    {
      id: '12.2',
      title: 'Run and export a report',
      persona: 'admin',
      app: 'web',
      screen: 'The Report library grouped by question, then the "Time & activity" report with filters, grouping and the Export menu.',
      actions: [
        'Click "Report library" and point at the reports.',
        'Click "Time & activity".',
        'Choose "Last month" in the date range; the rows are grouped by Member and Project, add Client as a third grouping.',
        'Click "Export" and choose "CSV".',
      ],
      narration:
        'The Report library is organized by the question you want answered: where did time go, who was late or absent, which timesheets are still pending, what is billable per client, and more. Open a report, for example Time and activity. Filter by date, members, teams, projects or clients, and group the rows by up to three things, such as member, project and client. Export downloads the result as CSV, Excel or PDF. Large reports can be prepared in the background, and you are notified when the file is ready.',
      overlays: ['Callout: "CSV · Excel · PDF"'],
      focus: ['Zoom to the filters and grouping.', 'Zoom to the Export menu.'],
      transition: 'Cut (stay on the report).',
    },
    {
      id: '12.3',
      title: 'Save a report and schedule it by email',
      persona: 'admin',
      app: 'web',
      screen: 'The "Save report" dialog with "Email on a schedule" switched on.',
      actions: [
        'Click "Save report".',
        'Type "Monthly hours by project" as the name.',
        'Switch on "Email on a schedule"; choose Monthly and the PDF format.',
        'Click "Save"; point at the report under "Saved reports".',
      ],
      narration:
        'If you need the same report regularly, save it. Click Save report and give it a name. Choose a relative date range, such as last month, so it always shows fresh numbers, and share it with everyone who can run the report if you like. Switch on Email on a schedule, choose how often and in which format, and add the recipients. WorkPulse now sends the report automatically. Saved reports appear at the top of the Report library.',
      overlays: ['Callout: "Delivered automatically by email"'],
      focus: ['Zoom to the Save report dialog.'],
      transition: 'Wipe to a chapter card: "Chapter 13 — Security and administration".',
    },
  ],
};
