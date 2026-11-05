import { registerCatalog } from '@tallywork/ui';

/** English strings for the New goal and Edit goal forms. Registered when imported, so they load with the form, not the page. */
export const perfGoalFormsEn = {
  'perf.gf.newTitle': 'New goal',
  'perf.gf.editTitle': 'Edit goal',
  'perf.gf.description': 'Progress is measured from real work; nobody types it in.',
  'perf.gf.name': 'Goal',
  'perf.gf.namePlaceholder': 'For example: Ship the beta',
  'perf.gf.text': 'Description',
  'perf.gf.for': 'For',
  'perf.gf.who': 'Who or what',
  'perf.gf.choose': 'Choose…',
  'perf.gf.measure': 'Measured by',
  'perf.gf.measureHint': 'Only measures that apply to this kind of goal are offered.',
  'perf.gf.target': 'Target',
  'perf.gf.targetHours': 'Target (hours)',
  'perf.gf.targetPct': 'Target (%)',
  'perf.gf.start': 'Starts',
  'perf.gf.end': 'Ends',
  'perf.gf.save': 'Save goal',
  'perf.gf.created': 'Goal set for {name}',
  'perf.gf.saved': 'Goal saved',
  'perf.gf.needName': 'Name the goal.',
  'perf.gf.needWho': 'Choose who or what the goal is for.',
  'perf.gf.needTarget': 'Enter a target above 0.',
  'perf.gf.pctTooHigh': 'A percentage target is at most 100.',
  'perf.gf.datesInvalid': 'The end date must be on or after the start date.',
  'perf.gf.orgOnly': 'Organization goals are for admins.',
} as const;

registerCatalog('en', perfGoalFormsEn, { base: true });
