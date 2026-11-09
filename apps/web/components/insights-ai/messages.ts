import { registerCatalog } from '@tallywork/ui';

/** English strings for the AI Insights page. Registered when imported, so they load with the page body only. */
export const aiInsightsEn = {
  'aiInsights.title': 'AI Insights',
  'aiInsights.description': 'Measured from your organization’s data. Facts, comparisons and estimates are labelled, and you only see what your role allows.',
  'aiInsights.period': 'Period',
  'aiInsights.period.this_week': 'This week',
  'aiInsights.period.last_week': 'Last week',
  'aiInsights.period.this_month': 'This month',
  'aiInsights.period.last_month': 'Last month',
  'aiInsights.tab.overview': 'Overview',
  'aiInsights.tab.workforce': 'Workforce',
  'aiInsights.tab.timesheets': 'Timesheets',
  'aiInsights.tab.projects': 'Projects',
  'aiInsights.comparedWith': 'Compared with {from} – {to}',
  'aiInsights.basis.fact': 'Measured',
  'aiInsights.basis.observation': 'Compared with previous period',
  'aiInsights.basis.estimate': 'Estimate',
  'aiInsights.severity.warning': 'Needs action',
  'aiInsights.severity.attention': 'Worth a look',
  'aiInsights.severity.info': 'For information',
  'aiInsights.previous': 'previously {value}',
  'aiInsights.nextStep': 'Next step',
  'aiInsights.ask': 'Ask WorkPulse AI',
  'aiInsights.askQuestion': 'Explain this insight and what I should do: "{title}" ({from} to {to}).',
  'aiInsights.limitations': 'Not included',
  'aiInsights.emptyTitle': 'Nothing needs your attention for this period',
  'aiInsights.emptyBody': 'Try another period, or check back after more time is recorded.',
  'aiInsights.unit.hours': '{value} h',
  'aiInsights.unit.percent': '{value} %',
  'aiInsights.unit.count': '{value}',
  'aiInsights.unit.days': '{value} d',
  'aiInsights.findingsLabel': 'Findings',
} as const;

registerCatalog('en', aiInsightsEn, { base: true });
