import type { Chapter } from '../scenes';

export const ch15: Chapter = {
  n: 15,
  title: 'Questions and troubleshooting',
  goal: 'Find answers to the most common questions and fix the most common problems.',
  scenes: [
    {
      id: '15.1',
      title: 'Frequently asked questions',
      persona: 'admin',
      app: 'web',
      screen: 'Help Center › Frequently asked questions, with several answers opened.',
      actions: [
        'Open Help and scroll to "Frequently asked questions".',
        'Open "Why are members sent to a download page when they sign in here?".',
        'Open "Can approved time still be changed?".',
        'Open "What happens if a member’s computer is offline?".',
        'Open "Are keystrokes recorded?".',
      ],
      narration:
        'Let us finish with the questions people ask most, all answered in the Help Center. Why are members sent to a download page? Because workers use the desktop app, not the website. Can approved time still be changed? Yes: reopen the timesheet, correct it and approve it again. Once its time is on an invoice, void the invoice first; once it has been paid, correct it with a bonus or deduction on the next payroll. What happens when a computer is offline? The app keeps tracking and sends everything when it is back online. And are keystrokes recorded? No. WorkPulse only counts keyboard and mouse activity. It never records what you type.',
      overlays: ['Callout per answer, e.g. "Offline? Nothing is lost"'],
      focus: ['Zoom to each answer as it opens.'],
      transition: 'Cut (stay in Help).',
    },
    {
      id: '15.2',
      title: 'Troubleshooting',
      persona: 'admin',
      app: 'web',
      screen: 'Help Center › Troubleshooting, with the guides opened one by one.',
      actions: [
        'Scroll to "Troubleshooting".',
        'Open "A member forgot to stop their timer".',
        'Open "A member’s time is missing".',
        'Open "The Approve button is greyed out".',
        'Open "A member doesn’t have the latest desktop app".',
      ],
      narration:
        'Troubleshooting covers the usual problems. A member forgot to stop their timer: force stop it from Live, then edit or split the entry in Time entries. A member\'s time is missing: check that their app is online, since offline time arrives when they reconnect, and that their computer is approved under Devices. For time they really did not track, add manual time. The Approve button is greyed out: time was added after the timesheet was submitted, so click Request changes and approve it once they resubmit. And if a member does not have the latest desktop app: updates download in the background and install when the member quits the app from its icon in the system tray. Each guide links straight to the page that fixes it.',
      overlays: [],
      focus: ['Zoom to each guide as it opens.'],
      transition: 'Wipe to the closing chapter.',
    },
  ],
};
