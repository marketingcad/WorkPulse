import type { Chapter } from '../scenes';

export const ch10: Chapter = {
  n: 10,
  title: 'Schedules, attendance and time off',
  goal: 'Set working hours, check attendance, and approve time off with policies, balances and holidays.',
  scenes: [
    {
      id: '10.1',
      title: 'Working hours',
      persona: 'admin',
      app: 'web',
      screen: 'Workforce › Schedules: everyone\'s week, and the schedule dialog for one member.',
      actions: ['Open Workforce › Schedules.', 'Click "Edit schedule for Ava Okafor".', 'Point at the time zone, "Effective from" and the start and end of each day.', 'Point at "Save new version", then close the dialog.'],
      narration:
        'Schedules hold everyone\'s working hours. Open Workforce, then Schedules, to see the week for each member. To change someone\'s hours, open their schedule. Set the time zone, the date the new hours start, and the start and end for each working day. Saving creates a new version, so past attendance is still measured against the hours that applied at the time. Members see their own schedule in the desktop app.',
      overlays: ['Callout: "New versions keep past attendance correct"'],
      focus: ['Zoom to the schedule dialog.'],
      transition: 'Cut to the Attendance tab.',
    },
    {
      id: '10.2',
      title: 'Attendance',
      persona: 'admin',
      app: 'web',
      screen: 'The Attendance roster for today: present, late, absent, on leave; then the week view.',
      actions: ['Click the "Attendance" tab.', 'Point at the statuses in the roster.', 'Choose "Late" in the Status filter, then "All statuses".', 'Click "Week".'],
      narration:
        'Attendance compares the schedule with the time actually tracked. For each person you see whether they are present, late, absent, on leave, on a holiday, or not started yet. Filter by status to follow up quickly, and switch between a single day and the whole week. WorkPulse can also alert managers about late starts and missed shifts.',
      overlays: [],
      focus: ['Zoom to the roster.'],
      transition: 'Cut to Time off.',
    },
    {
      id: '10.3',
      title: 'Approve time off, policies and holidays',
      persona: 'admin',
      app: 'web',
      screen: 'Workforce › Time off: the Requests tab with Ava\'s request, the Calendar, and the Policies & holidays tab.',
      actions: [
        'Open Workforce › Time off and click the "Requests" tab.',
        'Find Ava Okafor\'s request and click "Approve".',
        'Click the "Calendar" tab.',
        'Click the "Policies & holidays" tab and point at the policies, "Adjust balance", "New policy" and the holidays.',
      ],
      narration:
        'Time off requests arrive under Time off, on the Requests tab. Here is the request Ava sent from the desktop app. Approve it, or reject it with a comment, and she is notified straight away. The Calendar shows who is away and when. On Policies and holidays you set up the kinds of time off, such as paid time off or sick leave: whether they are paid, whether they need approval, and how much is earned each month. You can adjust a member\'s balance by hand, and add public holidays, which are paid automatically.',
      overlays: ['Callout: "Balances build up automatically with accruals"'],
      focus: ['Highlight Ava\'s request and the Approve button.', 'Zoom to the policies.'],
      transition: 'Wipe to a chapter card: "Chapter 11 — Money: rates, billing and payroll".',
    },
  ],
};
