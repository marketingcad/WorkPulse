import type { Grants } from '../permissions';
import { NAV_TARGETS, gateAllows, type NavGate, type NavTargetKey } from './navigation';

type Suggestion = { q: string; gate?: NavGate };

const TEAM_TIME: NavGate = { perms: ['time:read'], minScope: 'team_or_org' };
const LIVE: NavGate = { perms: ['tracking:read'], minScope: 'team_or_org' };

/** Docs questions (no gate) come first among the general ones so a worker always gets 3 or more. */
const GENERAL: Suggestion[] = [
  { q: 'How do I start tracking time?' },
  { q: 'How does timesheet approval work?' },
  { q: 'What can I do in WorkPulse?' },
  { q: 'Who is working right now?', gate: LIVE },
  { q: 'How many hours did the team log this week?', gate: TEAM_TIME },
];

const BY_SECTION: Partial<Record<NavTargetKey, Suggestion[]>> = {
  dashboard: [
    { q: 'Who is working right now?', gate: LIVE },
    { q: 'Which timesheets are awaiting approval?', gate: { perms: ['timesheets:approve'] } },
    { q: 'How many hours did the team log this week?', gate: TEAM_TIME },
  ],
  'timesheets.approvals': [
    { q: 'Which timesheets are awaiting approval?', gate: { perms: ['timesheets:approve'] } },
    { q: 'Are there pending manual time requests?', gate: { perms: ['manual_time:approve'] } },
    { q: 'How do I approve or reject a timesheet?' },
    { q: 'What happens after a timesheet is approved?' },
  ],
  'timesheets.all': [
    { q: 'How many hours did the team log this week?', gate: TEAM_TIME },
    { q: 'How do I edit a time entry?' },
    { q: 'What is manual time?' },
  ],
  'tracking.live': [
    { q: 'Who is working right now?', gate: LIVE },
    { q: 'How do I stop someone’s session?' },
    { q: 'What do idle and active mean?' },
  ],
  workers: [
    { q: 'How many members are in the organization?', gate: { perms: ['members:read'], minScope: 'team_or_org' } },
    { q: 'How do I invite a member?' },
    { q: 'What is the difference between roles?' },
  ],
  'finance.invoices': [
    { q: 'Which invoices are unpaid?', gate: { perms: ['invoices:read'] } },
    { q: 'How do I create an invoice?' },
    { q: 'How are billing rates applied?' },
  ],
  'finance.payroll': [
    { q: 'What do members owe or get owed?', gate: { perms: ['payroll:read', 'billing:read', 'rates:read'] } },
    { q: 'How is payroll calculated?' },
    { q: 'How do I set a pay rate?' },
  ],
  reports: [
    { q: 'Which reports are available?' },
    { q: 'How many hours did the team log this week?', gate: TEAM_TIME },
    { q: 'How do I export a report?' },
  ],
};

/**
 * 3 to 4 starter questions the person may ask: the page's own, then general ones, de-duplicated.
 * A page's questions are offered only to people who may open that page, so nobody is invited to
 * ask about something the assistant would then refuse (e.g. a manager on a payroll URL).
 */
export function suggestionsFor(grants: Grants, section: NavTargetKey | null): string[] {
  const page = section && gateAllows(grants, NAV_TARGETS[section]) ? BY_SECTION[section] : undefined;
  const pool = [...(page ?? []), ...GENERAL];
  const out: string[] = [];
  for (const s of pool) {
    if (s.gate && !gateAllows(grants, s.gate)) continue;
    if (!out.includes(s.q)) out.push(s.q);
    if (out.length === 4) break;
  }
  return out;
}
