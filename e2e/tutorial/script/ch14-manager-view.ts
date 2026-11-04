import type { Chapter } from '../scenes';

export const ch14: Chapter = {
  n: 14,
  title: 'The team manager\'s view',
  goal: 'Understand what a team manager sees and does, and why menus differ between people.',
  scenes: [
    {
      id: '14.1',
      title: 'WorkPulse as a team manager',
      persona: 'manager',
      app: 'web',
      screen: 'Maya Chen, manager of the Design team, signed in: her Overview, her shorter menu, and Approvals for her team.',
      actions: [
        'Point at the role under the organization name: "Team Manager".',
        'Point at the Overview scope switch showing her team.',
        'Open each menu group to show the pages she can use.',
        'Open Approvals and point at her team\'s timesheets.',
      ],
      narration:
        'Here is the same organization through the eyes of Maya, who manages the Design team. Her Overview shows her team, not the whole company. Her menu is shorter: she can approve her team\'s timesheets and time off, watch their work, and manage the projects she is assigned to, but she does not see rates, payroll or the organization settings. That is why two people can see different menus, and why a page someone else talks about may be missing for you. If you need access to something, ask an administrator to change your role.',
      overlays: ['Callout: "Menus follow your role"'],
      focus: ['Highlight the role name.', 'Zoom to the sidebar.'],
      transition: 'Wipe to a chapter card: "Chapter 15 — Questions and troubleshooting".',
    },
  ],
};
