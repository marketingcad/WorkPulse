import type { Chapter } from '../scenes';

export const ch05: Chapter = {
  n: 5,
  title: 'Add your people',
  goal: 'Invite members, read a member profile and organize people into teams with a manager.',
  scenes: [
    {
      id: '05.1',
      title: 'Invite a member',
      persona: 'admin',
      app: 'web',
      screen: 'Workforce › Members, the "Invite member" dialog, and the "Invitation ready" dialog with the invitation link.',
      actions: [
        'Open Workforce › Members and click "Invite member".',
        'Type "leo.martins@demo.tallywork.app" in Email and "Leo Martins" in Name.',
        'Keep the role "Worker".',
        'Open "Teams" and tick "Design"; open "Projects" and tick "Globex — Website Redesign".',
        'Click "Send invitation".',
        'Point at the "Invitation link" and the copy button, then click "Done".',
        'Point at "Pending invitations".',
      ],
      narration:
        'To add people, open Workforce, then Members, and click Invite member. Enter their email address and name, and choose a role. Most people you track are Workers. You can also put them in teams and give them projects right away, so everything is ready when they join. Click Send invitation. WorkPulse emails the invitation. If the email cannot be sent, the dialog shows the invitation link so you can share it yourself. Until the person accepts, the invitation waits under Pending invitations, where you can revoke it.',
      overlays: ['Callout: "Pick teams and projects now — they are ready on day one"'],
      focus: ['Zoom to the Invite member dialog.', 'Highlight the invitation link.'],
      transition: 'Cut to a member profile.',
    },
    {
      id: '05.2',
      title: 'A member’s profile',
      persona: 'admin',
      app: 'web',
      screen: 'The profile of Ava Okafor, a product designer: Overview, Personal info, Time, Activity, Projects, Devices and Policy tabs.',
      actions: ['Search "Ava" in Members and open Ava Okafor.', 'Point at the Profile and Access panels.', 'Click the tabs in turn: Personal info, Time, Projects, Devices, Policy.'],
      narration:
        'Click a member to open their profile. The Overview shows their details, quick links and access. Here you can suspend or remove someone, or reset their two-factor sign-in if they lose their phone. Personal info holds HR details and private notes. The other tabs show the member\'s time, activity, projects, the computers they use, and the tracking policy that applies to them, combined from the organization, their team and any personal overrides.',
      overlays: ['Callout: "Policy tab = what is actually tracked for this person"'],
      focus: ['Zoom to the profile tabs.', 'Highlight the Access panel.'],
      transition: 'Cut to the Teams tab.',
    },
    {
      id: '05.3',
      title: 'Create a team and choose its manager',
      persona: 'admin',
      app: 'web',
      screen: 'Workforce › Teams, the "New team" dialog, and the new team\'s panel with members and roles.',
      actions: [
        'Click the "Teams" tab and click "New team".',
        'Type "Video Production" and a description; click "Create team".',
        'In the team panel, choose "Priya Silva" in "Add member", set her role to "Manager", click "Add".',
        'Choose "Kenji Mensah" as a Member and click "Add".',
      ],
      narration:
        'Teams group people who work together. On the Teams tab, click New team, give it a name and a description, and click Create team. Then add people. A team member with the Manager role approves the team\'s timesheets and time off, and sees the team\'s time and activity. Here, Priya becomes the manager of the new Video Production team, and Kenji joins as a member. A person can belong to more than one team.',
      overlays: ['Callout: "Team managers approve their team’s timesheets and time off"'],
      focus: ['Zoom to the team panel while adding members.'],
      transition: 'Wipe to a chapter card: "Chapter 6 — Clients, projects and tasks".',
    },
  ],
};
