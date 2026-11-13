import type { Chapter } from '../scenes';

export const ch15: Chapter = {
  n: 15,
  title: 'The Performance Center',
  goal: 'Read the performance score, set a measured goal, and understand achievements and leaderboards.',
  scenes: [
    {
      id: '15.1',
      title: 'The performance score',
      persona: 'admin',
      app: 'web',
      screen: 'Performance › Performance overview: the organization score out of 100, the period switch, the score trend, and "What the score is made of"; then the Scoring rules dialog.',
      actions: [
        'Open Performance › Performance overview.',
        'Point at the organization score.',
        'Click "Quarter", then "Month".',
        'Scroll to "What the score is made of" and point at its five parts.',
        'Click "Scoring rules"; point at the weights and the total; close the dialog.',
      ],
      narration:
        'Performance shows how work is going, measured from real outcomes. Open Performance, then Performance overview. The organization score runs from 0 to 100 for the period you choose: a week, a month, a quarter or a year. What the score is made of lists its five parts: goal completion, project delivery, approved-work consistency, quality from manager reviews, and attendance. A part with no data yet is left out, and the others count for more. Activity levels, keystrokes and screenshots are never part of a score. Click Scoring rules to decide how much each part counts. The weights must add up to one hundred percent.',
      overlays: ['Callout: "Measured from outcomes, never from keystrokes"'],
      focus: ['Zoom to the organization score.', 'Zoom to "What the score is made of".', 'Zoom to the Scoring rules dialog.'],
      transition: 'Cut to Goals & challenges.',
    },
    {
      id: '15.2',
      title: 'Goals and achievements',
      persona: 'admin',
      app: 'web',
      screen: 'Performance › Goals & challenges and the "New goal" dialog; then Achievements & recognition with the catalog of badges.',
      actions: [
        'Open Performance › Goals & challenges and click "New goal".',
        'Type "Finish the Globex homepage" as the goal.',
        'Choose "Team" under For, and "Design" as who it is for.',
        'Choose "Tasks completed" under Measured by, and a target of 20; set the dates.',
        'Click "Save goal".',
        'Open Performance › Achievements & recognition and point at a badge with its Bronze to Platinum levels.',
      ],
      narration:
        'Goals are measured from real work, so nobody types progress in. Open Goals and challenges and click New goal. Name the goal and choose who it is for: a person, a team, a project or the whole organization. Choose how it is measured, such as tasks completed, approved hours or work delivered on time, then set a target and the dates, and click Save goal. From now on its progress updates by itself. Under Achievements and recognition, people earn badges automatically from their work, like Perfect Attendance or Project Finisher, at bronze, silver, gold and platinum levels. Managers can also recognize someone, always with a reason.',
      overlays: ['Callout: "Progress is measured, not typed in"'],
      focus: ['Zoom to the New goal dialog.', 'Highlight one achievement and its levels.'],
      transition: 'Cut to Leaderboards.',
      visuals: { steps: true },
    },
    {
      id: '15.3',
      title: 'Leaderboards and people',
      persona: 'admin',
      app: 'web',
      screen: 'Performance › Leaderboards with the People, Teams and Projects switch and the Role family filter; then Worker performance and one person\'s profile.',
      actions: [
        'Open Performance › Leaderboards.',
        'Point at the Role family filter and at a "Not ranked" row.',
        'Click "Teams", then "People".',
        'Open Performance › Worker performance and open Hana Rossi.',
        'Point at what her score is made of.',
      ],
      narration:
        'Leaderboards rank people by their performance score, but only against others in the same role family, so a designer is never compared with an engineer. Rankings never use hours, keyboard activity or screenshots. Someone with too few approved days in the period is scored, but not ranked yet. Switch to Teams or Projects to compare those instead. Worker performance lists everyone\'s score. Open a person to see what their score is made of and how it has changed over time.',
      overlays: ['Callout: "Compared within the same role family"'],
      focus: ['Zoom to the Role family filter.', 'Zoom to the person\'s score breakdown.'],
      transition: 'Wipe to a chapter card: "Chapter 16 — WorkPulse AI".',
    },
  ],
};
