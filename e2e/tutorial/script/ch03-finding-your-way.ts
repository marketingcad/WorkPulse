import type { Chapter } from '../scenes';

export const ch03: Chapter = {
  n: 3,
  title: 'Finding your way around',
  goal: 'Read the Overview, customize it, use the menu, switch organizations, and get help inside the app.',
  scenes: [
    {
      id: '03.1',
      title: 'The Overview dashboard',
      persona: 'admin',
      app: 'web',
      screen: 'Overview for Avery Admin: This month, Worked today, Waiting for approval, Project budgets and the other cards.',
      actions: [
        'Open the Overview.',
        'Point at "This month": Time logged, Est. pay, Billable time, Est. billable.',
        'Point at "Worked today".',
        'Point at "Waiting for approval".',
        'Scroll down through Project budgets and the other cards.',
        'Click "Me" in the scope switch, then "All" again.',
      ],
      narration:
        'The Overview is your home page. It updates live, so you always see the current picture. At the top, This month shows the time logged, the estimated pay, the billable time and the estimated amount to bill. Estimates come from your rates and become final once the time is approved. Worked today shows how much your team has tracked so far today. Waiting for approval counts the timesheets and manual time requests that need your decision, and Project budgets warns you before a project runs over. The switch at the top right changes whose numbers you see: everyone, only yourself, or one member.',
      overlays: ['Callout: "Estimates become final after approval"', 'Callout on the scope switch: "All · Me · Member"'],
      focus: ['Zoom to "This month" (130%).', 'Highlight "Waiting for approval".', 'Highlight the scope switch.'],
      transition: 'Cut (stay on the Overview).',
    },
    {
      id: '03.2',
      title: 'Customize the Overview',
      persona: 'admin',
      app: 'web',
      screen: 'The Overview in edit mode: each card shows size, move and hide controls; the "Hidden widgets" panel lists the cards you can add.',
      actions: [
        'Click "Customize".',
        'Point at a card\'s size, "Move up", "Move down" and "Hide widget" controls.',
        'Click "Move up" on a card.',
        'Point at the "Hidden widgets" panel.',
        'Click "Save layout".',
      ],
      narration:
        'You can arrange the Overview to suit the way you work. Click Customize. Every card now has controls to change its size, move it up or down, or hide it. Hidden cards wait in the Hidden widgets panel, so you can add them back at any time. There are cards for the current timer, who is working, recent screenshots, time off, attendance, invoices, weekly limits and more. When you are happy with the layout, click Save layout. Each person has their own layout, and Reset brings back the default.',
      overlays: ['Callout: "Each person has their own layout"'],
      focus: ['Zoom to one card\'s controls.', 'Highlight the "Save layout" button.'],
      transition: 'Cut to the sidebar.',
    },
    {
      id: '03.3',
      title: 'Menu, organizations, notifications and your account',
      persona: 'admin',
      app: 'web',
      screen: 'The sidebar, the organization switcher at the top left, the notifications bell and the account menu at the top right.',
      actions: [
        'Click "Time Tracking" in the sidebar to open the group and show its pages.',
        'Click the organization switcher and point at the organizations and "New organization"; press Escape.',
        'Click the notifications bell; point at the list and "Mark all read"; press Escape.',
        'Click the account menu; point at "Profile & devices", "What is monitored" and the theme buttons; press Escape.',
      ],
      narration:
        'The sidebar groups the pages by job: Time Tracking, Workforce, Project Management, Finance and Reports, with Settings and Help at the bottom. Click a group to open it. At the top left is the organization switcher. If you belong to more than one organization, switch between them here, or create a new one. At the top right, the bell shows your notifications, such as a timesheet waiting for approval or a time off request. Click Mark all read to clear them. Next to it is your account menu, with your profile and devices, what is monitored, and the light and dark themes.',
      overlays: ['Labels pop on as each control is clicked: "Organization switcher", "Notifications", "Account menu"'],
      focus: ['Zoom to the organization switcher menu.', 'Zoom to the notifications panel.', 'Zoom to the account menu.'],
      transition: 'Cut to the Help Center.',
    },
    {
      id: '03.4',
      title: 'The Help Center and the product tour',
      persona: 'admin',
      app: 'web',
      screen: 'Help Center: search, topics and guides; then the product tour stepping through the menu.',
      actions: [
        'Click "Help" in the sidebar.',
        'Type "invoice" in "Search help" and point at the results.',
        'Click "Create and send an invoice" to open the guide; point at the steps and the "Open" button.',
        'Clear the search, then click "Start the tour".',
        'Click "Next" three times, then "Skip tour".',
      ],
      narration:
        'Whenever you are unsure, open Help. The Help Center is a plain-language manual for the whole app. Search for what you want to do, for example invoice, and open a guide. Each guide gives you numbered steps, with buttons that take you straight to the right page. Many pages also have their own Help link at the top. If you are new, click Start the tour. It highlights each part of the screen with a short explanation. Use Next to move on, or Skip tour to close it. The tour starts by itself the first time you sign in.',
      overlays: ['Callout: "Search help with your own words"'],
      focus: ['Zoom to the search results.', 'Zoom to the tour card on each step.'],
      transition: 'Wipe to a chapter card: "Chapter 4 — Set up your organization".',
    },
  ],
};
