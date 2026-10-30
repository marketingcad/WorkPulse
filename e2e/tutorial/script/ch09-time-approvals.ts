import type { Chapter } from '../scenes';

export const ch09: Chapter = {
  n: 9,
  title: 'Time and approvals',
  goal: 'Find, correct and add time, approve or send back timesheets and manual time, and review a team\'s week.',
  scenes: [
    {
      id: '09.1',
      title: 'Find and correct time entries',
      persona: 'admin',
      app: 'web',
      screen: 'Time Tracking › Time entries with date and member filters, the "Edit time entry" dialog, and the revision history.',
      actions: [
        'Open Time Tracking › Time entries.',
        'Click "This week" and choose "Ava Okafor" in Member.',
        'Open "Entry actions" on an entry and choose "Edit".',
        'Type a note and a "Reason for change"; click "Save changes".',
        'Open "Entry actions" again and choose "View history".',
      ],
      narration:
        'Time entries is where you find and correct time. Pick a date range, then filter by member, client, project or task, or search. The totals at the bottom show the time logged, billable time, and the estimated pay and billing. To correct an entry, open its actions and choose Edit. Change what you need, and give a reason for the change. Every change is kept: View history shows each revision, who made it and why. You can also split an entry in two, duplicate it, or select several entries to mark them billable or delete them together.',
      overlays: ['Callout: "Every change keeps its history and reason"'],
      focus: ['Zoom to the filters.', 'Zoom to the Edit dialog.', 'Zoom to the revision history.'],
      transition: 'Cut (stay on Time entries).',
    },
    {
      id: '09.2',
      title: 'Add time for someone',
      persona: 'admin',
      app: 'web',
      screen: 'The "Add time" dialog: member, date, time logged, project and task, work performed and reason.',
      actions: [
        'Click "Add time".',
        'Choose the member and the date.',
        'Type 1:30 in "Time logged".',
        'Click "Choose project and task" and pick a project.',
        'Type what was done and a reason; click "Add time".',
      ],
      narration:
        'Sometimes time needs to be added by hand, for example a meeting away from the computer. Click Add time, choose the member and the date, and enter either a duration or a start and end time. Choose the project and task, describe the work and give a reason. Depending on your settings, the time goes straight onto the timesheet, or it becomes a manual time request for approval. Members can also import time from a CSV file on their timesheet, using the template provided.',
      overlays: ['Callout: "Duration or start–end"'],
      focus: ['Zoom to the Add time dialog.'],
      transition: 'Cut to Approvals.',
    },
    {
      id: '09.3',
      title: 'Approve timesheets and manual time',
      persona: 'admin',
      app: 'web',
      screen: 'Time Tracking › Approvals: the submitted timesheets, a timesheet opened in the side panel, and the manual time requests below.',
      actions: [
        'Open Approvals.',
        'Click a pending timesheet to open it; point at the days and totals.',
        'Click "Approve".',
        'Open another timesheet and click "Request changes"; type a comment and confirm.',
        'Scroll to "Manual time requests" and click "Approve" on a request.',
      ],
      narration:
        'When members submit their timesheets, they arrive in Approvals. Click a timesheet to review the days, projects and totals. If everything is right, click Approve. Approved time is final: it is what payroll pays and what invoices bill. If something needs fixing, click Request changes and explain what is wrong. The timesheet goes back to the member as a draft. Reject works the same way. To approve many at once, use the Approve button at the top of the list. Below, manual time requests wait for the same decision: approve or reject each one.',
      overlays: ['Callout: "Approved time feeds payroll and invoices"'],
      focus: ['Zoom to the timesheet panel.', 'Highlight the Approve button.', 'Zoom to the manual time requests.'],
      transition: 'Cut to the Team week tab.',
    },
    {
      id: '09.4',
      title: 'Your team\'s week',
      persona: 'admin',
      app: 'web',
      screen: 'Team week: hours per member for the week, with the previous and next week buttons.',
      actions: ['Click the "Team week" tab.', 'Point at the hours per member.', 'Click "Previous week", then "Next week".'],
      narration:
        'Team week gives you the whole team at a glance: the hours each member worked on each day of the week. It is the quickest way to spot missing days before you approve. Move between weeks with the arrows, and select a row to open that member\'s timesheet.',
      overlays: [],
      focus: ['Zoom to the hours table.'],
      transition: 'Wipe to a chapter card: "Chapter 10 — Schedules, attendance and time off".',
    },
  ],
};
