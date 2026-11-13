import type { Chapter } from '../scenes';

/**
 * The answers WorkPulse AI gives on camera (tutorial/assistant.ts plays them in the browser). Each is
 * something the real assistant writes for that question with its tools, and none quotes a figure
 * that changes with the recording date: the demo data is built relative to the day it is seeded.
 */
export const AI_SCRIPT = {
  attention: {
    question: 'What needs my attention this week?',
    title: 'What needs my attention this week',
    answer: [
      'Here is what stands out this week:',
      '',
      '- **Timesheets waiting for approval.** Several people have submitted timesheets that are not approved yet. Approved time is what payroll and invoices use, so open **Approvals** to review them.',
      '- **A project over its hours budget.** AI Insights shows which project has used more hours than planned. Check **Budgets** and agree the next step with the client.',
      '- **Late starts.** Some people have not started their scheduled shift today. **Attendance** shows who.',
      '',
      'Open AI Insights for the details behind each of these.',
    ].join('\n'),
  },
  howApprove: {
    question: 'How do I approve a timesheet?',
    answer: [
      'To approve a timesheet:',
      '',
      '1. Open **Time Tracking › Approvals**.',
      '2. Click a timesheet to review its days, projects and totals.',
      '3. Click **Approve**. Approved time is final: payroll pays it and invoices bill it.',
      '',
      'If something needs fixing, click **Request changes** and say what is wrong. The timesheet goes back to the member as a draft.',
    ].join('\n'),
  },
  explainTimesheets: {
    question: /^Explain this insight and what I should do: "\d+ timesheets? (is|are) waiting for approval"/,
    answer: [
      'These timesheets were submitted by your team but have not been approved yet.',
      '',
      '**Why it matters:** payroll and invoices only use approved time. Until these are approved, the pay and billing for those days are estimates.',
      '',
      '**What to do:** open **Approvals**, check each timesheet, and approve it, or request changes if something is wrong. If some people have not submitted yet, **Draft reminder** writes a short message you can send them.',
    ].join('\n'),
  },
  projectDescription: {
    text: 'A full redesign of the Globex Retail website: a new homepage, product pages and checkout, built and tested by the Design and Engineering teams for Globex Retail.',
    facts: ['Client: Globex Retail', 'Project: Globex — Website Redesign'],
  },
  reminder: {
    text: 'Hi, a quick reminder to submit your timesheet for last week when you have a moment. Approved time is what we use for pay and billing, so getting it in on time helps everyone. Thank you!',
    facts: ['Timesheet period: last week'],
  },
};

export const ch16: Chapter = {
  n: 16,
  title: 'WorkPulse AI',
  goal: 'Ask WorkPulse AI questions, use AI Insights, draft text with AI, and keep up with what needs attention.',
  scenes: [
    {
      id: '16.1',
      title: 'Asking WorkPulse AI',
      persona: 'admin',
      app: 'web',
      screen: 'The Overview with the WorkPulse AI panel open on the right: suggested questions, then an answer, then a how-to answer.',
      actions: [
        'Click "Ask WorkPulse AI".',
        'Click the suggested question "What needs my attention this week?" and let the answer appear.',
        'Type "How do I approve a timesheet?" and send it.',
        'Point at the note "Answers can be wrong. Check important figures on the page itself."',
      ],
      narration:
        'WorkPulse AI answers questions about how WorkPulse works and about your own organization. Click Ask WorkPulse AI to open it. It suggests questions for the page you are on, or you can type your own. Ask what needs your attention this week, and it looks through approvals, budgets and attendance for you. Ask how to do something, like approving a timesheet, and it gives you the steps. WorkPulse AI only sees what you are allowed to see. It can be wrong, so check important figures on the page itself. Your conversations are kept under the chat history, and New chat starts a fresh one.',
      overlays: ['Callout: "It only sees what you can see"'],
      focus: ['Zoom to the WorkPulse AI panel.', 'Zoom to the answer.'],
      transition: 'Cut to AI Insights.',
    },
    {
      id: '16.2',
      title: 'AI Insights',
      persona: 'admin',
      app: 'web',
      screen: 'Reports › AI Insights: the period switch, the tabs (Overview, Workforce, Timesheets, Projects, Workflow, Capacity, Finance), finding cards; then an explanation in the WorkPulse AI panel.',
      actions: [
        'Open Reports › AI Insights.',
        'Point at the period switch and the tabs.',
        'Point at the first finding: its label, what was found, the figure and the next step.',
        'Click "Explain with WorkPulse AI" on the timesheets finding and let the explanation appear.',
        'Click the "Capacity" tab.',
      ],
      narration:
        'AI Insights looks through your organization\'s data and points out what needs attention. Every finding is measured from your own data, labelled as a fact, a comparison or an estimate, and you only see what your role allows. Choose a period, then a tab: workforce, timesheets, projects, workflow, capacity for the next two weeks, and finance for people who handle money. Each finding says what was found, by how much, and the next step, with a link to the right page. Click Explain with WorkPulse AI, and the assistant explains the finding and what to do about it.',
      overlays: ['Callout: "Measured from your data · labelled · permission-aware"'],
      focus: ['Zoom to a finding card.', 'Zoom to the explanation.'],
      transition: 'Cut to a project\'s settings.',
    },
    {
      id: '16.3',
      title: 'Write with AI',
      persona: 'admin',
      app: 'web',
      screen: 'A project\'s Settings tab with the description field and its "Write with AI" menu; then a timesheets finding in AI Insights and the reminder draft.',
      actions: [
        'Open the project "Globex — Website Redesign" and its Settings tab.',
        'Click "Write with AI" under Description, then "Draft from what WorkPulse knows".',
        'Point at the draft and the "Undo" button.',
        'Open Reports › AI Insights, choose "Last week" and the Timesheets tab, and click "Draft reminder" on "… timesheets have not been submitted".',
        'Point at the reminder draft.',
      ],
      narration:
        'WorkPulse AI can also write for you. In a project or task, click Write with AI under the description, and choose Draft from what WorkPulse knows. It writes a description from the project\'s own facts, which are listed so you can check them. You can also rewrite text you typed, shorter, longer or more professional. The draft only fills the field: edit it, keep it or click Undo, and nothing is saved until you save. In AI Insights, Draft reminder writes a friendly reminder for people who have not submitted their timesheet, ready for you to send.',
      overlays: ['Callout: "You edit and save. Nothing is sent for you."'],
      focus: ['Zoom to the description and its draft.', 'Zoom to the reminder draft.'],
      transition: 'Cut to the notifications.',
    },
    {
      id: '16.4',
      title: 'Staying informed',
      persona: 'admin',
      app: 'web',
      screen: 'The notifications panel with priority labels and grouped notifications; then Profile and devices with the notification settings and the weekly AI Insights summary.',
      actions: [
        'Click the bell.',
        'Point at an "Urgent" and an "Important" label, and at a "+ more" group.',
        'Open the account menu, choose "Profile & devices", and scroll to the notification settings.',
        'Point at "Weekly summary of what needs my attention (AI Insights)".',
      ],
      narration:
        'Notifications now come sorted by priority. Urgent and important ones are labelled, and similar notifications are grouped, so ten devices going offline take one line instead of ten. Open a group to see them all. To choose what you are told about, open your account menu, then Profile and devices. Managers can switch on a weekly summary of what needs their attention, written from AI Insights, so the most important things reach you even when you are busy.',
      overlays: ['Callout: "Grouped by kind, sorted by priority"'],
      focus: ['Zoom to the notifications panel.', 'Highlight the weekly summary setting.'],
      transition: 'Wipe to a chapter card: "Chapter 17 — Frequently asked questions".',
    },
  ],
};
