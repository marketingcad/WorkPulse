import type { Chapter } from '../scenes';

export const ch08: Chapter = {
  n: 8,
  title: 'Watching the work',
  goal: 'See who is working now, review sessions, screenshots, apps and websites, read end-of-day reports, and know what members are told.',
  scenes: [
    {
      id: '08.1',
      title: 'Who is working now',
      persona: 'admin',
      app: 'web',
      screen: 'Time Tracking › Live: "Who is working now" with the Working, Idle / paused and Offline counts and the list of members.',
      actions: [
        'Open Time Tracking › Live.',
        'Point at the counts: Working, Idle / paused, Offline, Members tracked.',
        'Click "Working" in the status filter.',
        'Open the actions of one member and point at "View activity", "View session" and "Force stop timer".',
        'Click "Force stop timer" and confirm with "Stop timer".',
      ],
      narration:
        'Back in the web app, let us see the work as it happens. Open Time Tracking, then Live. Who is working now shows everyone\'s status, updated live: working, idle or paused, or offline, with the project they are on and how long they have been working. Filter by status to focus on one group. From a member\'s actions you can open their activity or their current session. And if someone forgot to stop their timer, choose Force stop timer. The desktop app stops within about a minute, and the change is recorded in the audit log.',
      overlays: ['Callout: "Forgot to clock out? Force stop the timer"'],
      focus: ['Zoom to the status counts.', 'Zoom to the actions menu.'],
      transition: 'Cut to the Session history tab.',
    },
    {
      id: '08.2',
      title: 'Session history',
      persona: 'admin',
      app: 'web',
      screen: 'Session history with filters, and the session details panel with its segments and state changes.',
      actions: ['Click the "Session history" tab.', 'Point at the date range and member filters.', 'Click a session to open its details.', 'Point at Worked, Segments and State changes, and at "View activity for this day".'],
      narration:
        'Session history lists every work session: who, on which project and task, where it was tracked from, when it started and ended, and why it ended. Filter by date or member, or search. Click a session to see its details: the time worked, each segment between pauses and breaks, and every change of state. From here you can jump to that day\'s activity.',
      overlays: [],
      focus: ['Zoom to the session details panel.'],
      transition: 'Cut to the Activity page.',
    },
    {
      id: '08.3',
      title: 'Screenshots, apps and websites',
      persona: 'admin',
      app: 'web',
      screen: 'Time Tracking › Activity for Ava Okafor on a working day: the timeline of ten-minute blocks with screenshots; then the Apps and URLs tabs.',
      actions: [
        'Open Time Tracking › Activity, choose Ava Okafor and a working day.',
        'Point at the timeline and the activity levels.',
        'Click a block with a screenshot and point at "Block details".',
        'Click the "Apps" tab, then the "URLs" tab.',
      ],
      narration:
        'Activity shows how a day went, in ten-minute blocks. Choose a member and a day. Each block shows the activity level, the share of time with keyboard or mouse use, and the screenshots taken, if your policy records them. Click a block for its details. Use the activity filter to find quiet periods quickly. The Apps and URLs tabs show which applications and websites were used, and for how long. Remember: keystrokes are only counted, never recorded, and members see the same information about themselves.',
      overlays: ['Callout: "10-minute blocks"', 'Callout: "Keystrokes counted, never recorded"'],
      focus: ['Zoom to a screenshot block.', 'Zoom to the Apps list.'],
      transition: 'Cut to End-of-day reports.',
    },
    {
      id: '08.4',
      title: 'End-of-day reports',
      persona: 'admin',
      app: 'web',
      screen: 'Time Tracking › End-of-day reports: the summary counts, the reports grouped by day, and the full report of Ava Okafor.',
      actions: [
        'Open Time Tracking › End-of-day reports.',
        'Point at Reports, People reporting, Marked finished and Time covered.',
        'Click "Read full report from Ava Okafor".',
        'Click "Next" to read the next report, then "Copy report", then close.',
      ],
      narration:
        'Remember the report Ava wrote when she clocked out? Managers read them under End-of-day reports. The summary shows how many reports came in, from how many people, how many marked their work as finished, and the time they cover. Reports are grouped by day. Click one to read it in full, with its session. Previous and Next move through the reports, and Copy report puts the text on your clipboard, for example to paste into a client update.',
      overlays: ['Callout: "Written by the worker at clock-out"'],
      focus: ['Zoom to the report dialog.'],
      transition: 'Cut to "What is monitored".',
    },
    {
      id: '08.5',
      title: 'What is monitored: full transparency',
      persona: 'admin',
      app: 'web',
      screen: 'The "What is monitored" page: While you track time, Limits and time rules, Who can see this data.',
      actions: ['Open the account menu and choose "What is monitored".', 'Scroll through the three panels.'],
      narration:
        'Monitoring works best when everyone knows the rules. Every person can open What is monitored from their account menu. It explains in plain language what is recorded while they track time, which limits and time rules apply, and who can see their data. Owners, administrators and managers are not tracked unless you choose to track them.',
      overlays: ['Callout: "Everyone can see what is tracked about them"'],
      focus: ['Zoom to "Who can see this data".'],
      transition: 'Wipe to a chapter card: "Chapter 9 — Time and approvals".',
    },
  ],
};
