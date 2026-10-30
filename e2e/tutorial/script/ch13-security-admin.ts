import type { Chapter } from '../scenes';

export const ch13: Chapter = {
  n: 13,
  title: 'Security and administration',
  goal: 'Manage computers, sign-in security and access reviews, screenshot retention, integrations, and the audit log.',
  scenes: [
    {
      id: '13.1',
      title: 'Devices',
      persona: 'admin',
      app: 'web',
      screen: 'Settings › Devices: every computer signed in to the desktop app, and the actions for one device.',
      actions: ['Open Settings and click the "Devices" tab.', 'Point at the list: member, system, version and status.', 'Open the actions of a device and point at "Approve device", "Require sign-in again" and "Revoke device"; press Escape.'],
      narration:
        'Settings, Devices lists every computer signed in to the desktop app: whose it is, the operating system, the app version and its status. From a device\'s actions you can approve it, when your organization requires approval for new computers, ask for a new sign-in, or revoke it, for example when a laptop is lost. A revoked device can no longer send any data.',
      overlays: ['Callout: "Lost laptop? Revoke the device"'],
      focus: ['Zoom to the device actions.'],
      transition: 'Cut to Security & retention.',
    },
    {
      id: '13.2',
      title: 'Sign-in security and access review',
      persona: 'admin',
      app: 'web',
      screen: 'Settings › Security & retention, then Access review with its counts and the list of members without two-factor.',
      actions: [
        'Click the "Security & retention" tab.',
        'Point at "Require two-factor authentication", "Session lifetime (hours)", "Require device approval" and "Allowed networks (IP allowlist)".',
        'Click the "Access review" tab and point at Active members, Without two-factor, Roles and Active API keys.',
      ],
      narration:
        'Under Security and retention you decide how people sign in. Require two-factor authentication for admins only or for everyone, set how long a session lasts, require approval for new devices, and limit sign-in to your office networks with an IP allowlist. The data retention settings decide how long data is kept. Access review then gives you a regular check of who can do what: every active member, who still has no two-factor sign-in, your roles and their permissions, and the active API keys.',
      overlays: ['Callout: "Require two-factor for everyone"'],
      focus: ['Zoom to "Sign-in & access".', 'Zoom to the Access review counts.'],
      transition: 'Cut to Screenshot retention.',
    },
    {
      id: '13.3',
      title: 'Keep screenshots for a set time',
      persona: 'admin',
      app: 'web',
      screen: 'Settings › Screenshot retention: the retention policy, the preview of what would be deleted, and the cleanup history.',
      actions: ['Click the "Screenshot retention" tab.', 'Point at "Keep screenshots for" and "How often".', 'Click "Preview cleanup" and point at the result.', 'Point at "Cleanup history".'],
      narration:
        'Screenshots are kept for a set period, thirty days by default, and older ones are deleted automatically on a schedule. Nothing is ever deleted until an administrator previews what would go and approves it. Click Preview cleanup to see how many screenshots would be deleted, then approve the cleanup. If you shorten the period later, the approval is withdrawn and you are asked again. The history below shows every cleanup that ran.',
      overlays: ['Callout: "Nothing is deleted without approval"'],
      focus: ['Zoom to the preview result.'],
      transition: 'Cut to API keys.',
    },
    {
      id: '13.4',
      title: 'Connect other systems: API keys and webhooks',
      persona: 'admin',
      app: 'web',
      screen: 'Settings › API keys with the "Create API key" dialog and the one-time key; then Webhooks with the "Add endpoint" dialog.',
      actions: [
        'Click the "API keys" tab and "Create API key".',
        'Type "Accounting sync", tick a scope, choose "In 90 days", click "Create key".',
        'Point at the key, then click "I have stored the key".',
        'Click the "Webhooks" tab and "Add endpoint"; type the endpoint URL, tick "All events, including future ones", switch "Enabled" off and click "Add endpoint".',
        'Click "I have stored the secret".',
      ],
      narration:
        'To connect WorkPulse to other systems, such as accounting or HR software, create an API key. Give it a name, choose exactly what it may access, and when it expires. The key is shown only once, so store it safely. Webhooks work the other way around: WorkPulse calls your system when something happens, for example when a timesheet is approved. Add the endpoint address and choose the events. You can leave it switched off until your system is ready. Each delivery is signed with a secret, so your system can check it really comes from WorkPulse.',
      overlays: ['Callout: "The key is shown only once"'],
      focus: ['Zoom to the Create API key dialog.', 'Zoom to the Add endpoint dialog.'],
      transition: 'Cut to the Audit log.',
    },
    {
      id: '13.5',
      title: 'The audit log',
      persona: 'admin',
      app: 'web',
      screen: 'Settings › Audit log with filters, one entry opened, and the Export CSV button.',
      actions: ['Click the "Audit log" tab.', 'Type "client" in "Action starts with".', 'Click an entry to open its details; close it.', 'Point at "Export CSV".'],
      narration:
        'Finally, the audit log records every important action: who did what, when, and to what. Earlier we deleted a client; here is that action. Filter by action, by type, or by date, and open an entry to see the details. The log cannot be changed, and you can export it to CSV for your records. And for privacy requests, a member\'s profile lets you export all of their personal data, or erase it.',
      overlays: ['Callout: "Tamper-proof"'],
      focus: ['Zoom to the entry details.'],
      transition: 'Wipe to a chapter card: "Chapter 14 — The team manager\'s view".',
    },
  ],
};
