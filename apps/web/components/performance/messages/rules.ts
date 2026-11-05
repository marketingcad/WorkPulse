import { registerCatalog } from '@tallywork/ui';

/** English strings for the Scoring rules dialog. Registered when imported, so they load with the pages that use them. */
export const perfRulesEn = {
  'perf.rules.title': 'Scoring rules',
  'perf.rules.description': 'Version {version}. Each score is built from these five outcomes. Saving new weights creates a new version; final scores keep the version they were calculated with.',
  'perf.rules.total': 'Total: {total}% (must be 100%)',
  'perf.rules.weightInvalid': 'Use a whole number from 0 to 100.',
  'perf.rules.minDays': 'Minimum approved days to be ranked',
  'perf.rules.minDaysHint': 'People with fewer approved days in a period are scored but not ranked.',
  'perf.rules.minDaysInvalid': 'Use a whole number from 0 to 60.',
  'perf.rules.never': 'Activity levels, keystrokes and screenshots are never part of a score.',
  'perf.rules.save': 'Save rules',
  'perf.rules.saved': 'Scoring rules saved',
  'perf.rules.savedVersion': 'Scoring rules saved as version {version}',
} as const;

registerCatalog('en', perfRulesEn, { base: true });
