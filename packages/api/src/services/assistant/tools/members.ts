import { z } from 'zod';
import { listMemberOptions } from '../../org';
import { listTeams } from '../../work';
import { redactEmployee } from '../redact';
import { capOutput, has, matchByName, nameArg, NO_TEAM } from './shared';
import type { AssistantTool } from './types';

const input = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'INVITED', 'REMOVED']).optional(),
    team: nameArg.optional().describe('Team name'),
    q: z.string().trim().min(1).max(100).optional().describe('Part of a name or job title'),
  })
  .strict();

export const membersTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getEmployeeSummary',
  description: 'People the person can see: name, role, status, job title, whether time tracking is on, and expected weekly hours. Filter by status, team name or part of a name or title.',
  input,
  allowed: (a) => has(a, 'members:read'),
  statusKey: 'checking_people',
  async run(x, q) {
    let rows = await listMemberOptions(x, { includeRemoved: q.status === 'REMOVED' });
    if (q.status) rows = rows.filter((m) => m.status === q.status);
    if (q.team) {
      // Team names are matched against the teams the actor may see; without teams:read none match.
      const teams = has(x.actor, 'teams:read') ? matchByName(await listTeams(x), q.team) : [];
      if (!teams.length) return { data: { rows: [], truncated: false, note: NO_TEAM } };
      const ids = new Set(teams.flatMap((t) => t.members.map((m) => m.membership_id)));
      rows = rows.filter((m) => ids.has(m.id));
    }
    if (q.q) {
      // Name and title only, never the email.
      const term = q.q.toLowerCase();
      rows = rows.filter((m) => m.name.toLowerCase().includes(term) || (m.title ?? '').toLowerCase().includes(term));
    }
    const out = capOutput(rows.map(redactEmployee));
    return { data: { rows: out.rows, truncated: out.truncated, total: rows.length } };
  },
};
