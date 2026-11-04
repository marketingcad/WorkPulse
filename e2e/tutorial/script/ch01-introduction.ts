import type { Chapter } from '../scenes';

export const ch01: Chapter = {
  n: 1,
  title: 'Welcome to WorkPulse',
  goal: 'Know what WorkPulse does, who uses which app, and how this tutorial is organized.',
  scenes: [
    {
      id: '01.1',
      title: 'Opening',
      persona: 'admin',
      app: 'web',
      screen: 'The WorkPulse Overview for the demo company, Northwind Creative, full screen. The cursor rests in the middle of the page.',
      actions: ['Open the Overview.', 'Let the live cards load, then rest on the page.', 'Slowly move the cursor across the "This month" figures.'],
      narration:
        'Welcome to WorkPulse. Track, focus, achieve. In this tutorial you will learn how to use WorkPulse from beginning to end: setting up your organization, inviting your team, tracking time with the desktop app, approving timesheets, billing your clients, running payroll, and getting the reports you need. Everything you see is the real application, running with a demo company called Northwind Creative, so you can follow along step by step.',
      overlays: ['Title card: "WorkPulse — Complete Tutorial"', 'Subtitle: "Track • Focus • Achieve"', 'Lower third at 0:20: "Demo company: Northwind Creative"'],
      focus: ['Open on the WorkPulse logo for 3 seconds, then dissolve into the recording.', 'Slow 110% push-in on the "This month" card while the narration lists the topics.'],
      transition: 'Cross-dissolve (0.5 s) to the Members page.',
    },
    {
      id: '01.2',
      title: 'Who uses which app',
      persona: 'admin',
      app: 'web',
      screen: 'Workforce › Members: the list of people with their roles (System Admin, Team Manager, Worker).',
      actions: ['Open Workforce › Members.', 'Point at the Role column for a Team Manager.', 'Point at the Role column for a Worker.', 'Point at the "Demo data" badge in the top bar.'],
      narration:
        'WorkPulse has three kinds of users. Administrators and managers use this web app to organize people and projects, approve time, and handle billing and payroll. Workers, the people whose time is tracked, use the WorkPulse desktop app on Windows, macOS or Linux. It tracks their time and shows them their own timesheet, time off and pay stubs. And your clients can get a read-only client portal that shows the work done for them, without any money. What each person sees depends on their role, so two people can see different menus. That is normal, and we will come back to it later.',
      overlays: ['Three icons with labels: "Admins & managers → web app", "Workers → desktop app", "Clients → client portal"'],
      focus: ['Highlight a "Team Manager" role cell, then a "Worker" role cell.'],
      transition: 'Cut to the Overview with the sidebar in focus.',
    },
    {
      id: '01.3',
      title: 'How this tutorial is organized',
      persona: 'admin',
      app: 'web',
      screen: 'The Overview with the left-hand menu. Each menu group opens in turn: Time Tracking, Workforce, Project Management, Finance, Reports.',
      actions: ['Click each menu group in turn to open it: Time Tracking, Workforce, Project Management, Finance, Reports.', 'Point at Settings and Help at the bottom of the menu.'],
      narration:
        'The menu on the left follows the way work flows through WorkPulse. You set up the organization and invite people. You organize the work into clients, projects and tasks. Your team tracks time. Managers review and approve it. Approved time becomes invoices and payroll. And reports turn it all into insight. This tutorial follows the same order, and the chapter list in the description lets you jump to any part.',
      overlays: ['Flow ribbon across the bottom: "Organization → People → Work → Tracking → Time → Approval → Money → Insight"'],
      focus: ['Zoom to 130% on the sidebar while the groups open.'],
      transition: 'Wipe to a chapter card: "Chapter 2 — Getting started".',
    },
  ],
};
