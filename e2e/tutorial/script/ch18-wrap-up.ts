import type { Chapter } from '../scenes';

export const ch16: Chapter = {
  n: 16,
  title: 'Wrap-up',
  goal: 'Remember the main workflow and where to go next.',
  scenes: [
    {
      id: '16.1',
      title: 'Recap',
      persona: 'admin',
      app: 'web',
      screen: 'The Overview again, now with this tutorial\'s work in it; the cursor moves over the cards.',
      actions: ['Open the Overview.', 'Point at "Waiting for approval", "Project budgets" and "Invoices".', 'Rest on the page.'],
      narration:
        'Let us recap the whole journey. You created your organization and set the rules for time and pay. You invited your people, organized them into teams, and set up clients, projects and tasks. Workers tracked their time with the desktop app, with breaks, idle checks and end-of-day reports. Managers watched the work, corrected time and approved timesheets. And approved time became invoices and payroll, with reports to tell you how it all went. Everything comes together here on the Overview.',
      overlays: ['Checklist builds on screen: Set up ✓ People ✓ Work ✓ Track ✓ Approve ✓ Bill & pay ✓ Report ✓'],
      focus: ['Slow push-in on the Overview.'],
      transition: 'Fade to the end card.',
    },
    {
      id: '16.2',
      title: 'Closing',
      persona: 'admin',
      app: 'edit',
      screen: 'End card: the WorkPulse logo, "Track • Focus • Achieve", and where to get help.',
      actions: ['No recording: the end card is made in the editor.'],
      narration:
        'Thank you for watching. Whenever you need a reminder, open Help inside WorkPulse: every topic in this video has a step-by-step guide there, and the product tour is one click away. Now it is your turn. Track, focus, achieve.',
      overlays: ['End card: WorkPulse logo', '"Track • Focus • Achieve"', '"Help is always in the app: Help › Search"'],
      focus: [],
      transition: 'Fade to black (1 s).',
    },
  ],
};
