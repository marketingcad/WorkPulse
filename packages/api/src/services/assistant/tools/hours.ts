import { z } from 'zod';
import type { TimeEntryTotalRow } from '@tallywork/contracts';
import { listMemberOptions } from '../../org';
import { timeEntryTotals } from '../../timesheets';
import { listProjects } from '../../work';
import type { Ctx } from '../../ctx';
import { redactHours } from '../redact';
import { capOutput, dateRange, has, hours, matchByName, nameArg, NO_MEMBER } from './shared';
import type { AssistantTool } from './types';

const input = dateRange({
  group: z.enum(['member', 'day', 'project']),
  member: nameArg.optional().describe('Only this person (their name)'),
});

type Sum = { seconds: number; billable: number; manual: number };
const zero = (): Sum => ({ seconds: 0, billable: 0, manual: 0 });
const add = (s: Sum, r: TimeEntryTotalRow) => {
  s.seconds += r.seconds;
  s.billable += r.billable_seconds;
  s.manual += r.manual_seconds;
  return s;
};
const sum = (rows: TimeEntryTotalRow[]) => rows.reduce(add, zero());

/** Projects whose hours are looked up one by one; time on the rest is reported as one figure. */
const MAX_PROJECTS = 50;

export const hoursTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getHoursSummary',
  description: 'Hours worked in a date range (at most 93 days), grouped by member, day or project: total, billable and manual hours. Optionally for one person by name.',
  input,
  allowed: (a) => has(a, 'time:read'),
  statusKey: 'checking_hours',
  async run(x, q) {
    // Names come from the scoped member list; a name outside it matches nothing.
    const members = has(x.actor, 'members:read') ? await listMemberOptions(x, { includeRemoved: true }) : [];
    let membershipIds: string[] | undefined;
    if (q.member) {
      const found = matchByName(members, q.member);
      if (!found.length) return { data: { from: q.from, to: q.to, group: q.group, rows: [], total_hours: 0, note: NO_MEMBER } };
      membershipIds = found.map((m) => m.id);
    }
    const range = { from: q.from, to: q.to, membershipIds };
    const totals = await timeEntryTotals(x, range);
    const total = sum(totals);
    const head = { from: q.from, to: q.to, group: q.group, total_hours: hours(total.seconds), billable_hours: hours(total.billable), manual_hours: hours(total.manual) };

    if (q.group === 'project') return { data: { ...head, ...(await byProject(x, range, total)) } };

    const groups = new Map<string, Sum>();
    for (const r of totals) {
      const k = q.group === 'member' ? r.membership_id : r.date;
      groups.set(k, add(groups.get(k) ?? zero(), r));
    }
    const nameOf = new Map(members.map((m) => [m.id, m.name]));
    const rows =
      q.group === 'member'
        ? [...groups]
            .map(([id, s]) => [nameOf.get(id) ?? 'Unnamed member', s] as const)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([member, s]) => redactHours({ member }, s))
        : [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([date, s]) => redactHours({ date }, s));
    const out = capOutput(rows);
    return { data: { ...head, rows: out.rows, truncated: out.truncated } };
  },
};

/**
 * Hours per project the actor can see (timeEntryTotals has no project grouping, so each visible
 * project is summed on its own). Time on projects they can't see, or past the cap, is one figure.
 */
async function byProject(x: Ctx, range: { from: string; to: string; membershipIds?: string[] }, total: Sum) {
  if (!has(x.actor, 'projects:read')) return { rows: [], truncated: false, note: 'Project names are not available to you.' };
  const projects = await listProjects(x, { includeArchived: true });
  const found: Array<[string, Sum]> = [];
  let named = 0;
  for (const p of projects.slice(0, MAX_PROJECTS)) {
    const s = sum(await timeEntryTotals(x, { ...range, projectId: p.id }));
    if (!s.seconds) continue;
    named += s.seconds;
    found.push([p.name, s]);
  }
  found.sort(([a, s], [b, t]) => t.seconds - s.seconds || a.localeCompare(b));
  const out = capOutput(found.map(([project, s]) => redactHours({ project }, s)));
  return { rows: out.rows, truncated: out.truncated || projects.length > MAX_PROJECTS, other_projects_hours: hours(Math.max(0, total.seconds - named)) };
}
