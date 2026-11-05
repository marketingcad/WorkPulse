import { registerCatalog } from '@tallywork/ui';

/** English strings for Team performance. Registered when imported, so they load with the pages that use them. */
export const perfTeamsEn = {
  'perf.teams.title': 'Team performance',
  'perf.teams.description': 'Compare teams on their goals, delivery, attendance and recognition. Managers see only the teams they manage.',
  'perf.teams.pick': 'Compare up to 3',
  'perf.teams.pickHint': 'Choose up to three teams to compare',
  'perf.teams.meta': '{count, plural, one {# person} other {# people}}',
  'perf.teams.rankOf': '#{rank} of {total}',
  'perf.teams.change': '{sign}{n} vs the previous period',
  'perf.teams.noChange': 'No score last period to compare',
  'perf.teams.stat.hours': 'Approved time',
  'perf.teams.stat.goals': 'Goals',
  'perf.teams.stat.milestones': 'Milestones on time',
  'perf.teams.stat.attendance': 'Attendance',
  'perf.teams.stat.achievements': 'Achievements',
  'perf.teams.stat.rank': 'Rank',
  'perf.teams.stat.score': 'Score',
  'perf.teams.ranksHidden': 'Ranks are hidden from managers in this organization.',
  'perf.teams.trend': 'Score over time',
  'perf.teams.trendLabel': 'Team scores over the last six periods',
  'perf.teams.trendEmpty': 'No scores yet for these teams',
  'perf.teams.people': 'People',
  'perf.teams.peopleOf': '{team} · people',
  'perf.teams.peopleTeam': 'Team',
  'perf.teams.manager': 'Manager',
  'perf.teams.personMeta': '{hours} approved',
  'perf.teams.notRanked': 'not ranked',
  'perf.teams.peopleNote': 'A team’s score is the average of its members’ scores, weighted by approved days.',
  'perf.teams.peopleEmpty': 'Nobody in this team yet',
  'perf.teams.side': 'Side by side',
  'perf.teams.metric': 'Measure',
  'perf.teams.notMeasured': 'Not measured',
  'perf.teams.none': 'No teams to compare',
  'perf.teams.noneHint': 'Create teams and add people to them to compare their performance.',
} as const;

registerCatalog('en', perfTeamsEn, { base: true });
