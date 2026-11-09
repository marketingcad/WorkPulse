import { z } from 'zod';
import { listMemberOptions } from '../../org';
import { listProjects, listTeams } from '../../work';
import { redactOverview } from '../redact';
import { has } from './shared';
import type { AssistantTool } from './types';

const input = z.object({}).strict();

export const overviewTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getOrganizationOverview',
  description: 'The organization at a glance: name, time zone, active members by role, and how many teams and projects the person can see.',
  input,
  allowed: (a) => has(a, 'org:read'),
  statusKey: 'checking_organization',
  async run(x) {
    // Each count comes from the scoped service, and only when the actor may read that kind of data.
    let activeByRole: Record<string, number> | null = null;
    if (has(x.actor, 'members:read')) {
      activeByRole = {};
      for (const m of await listMemberOptions(x)) if (m.status === 'ACTIVE') activeByRole[m.role_name] = (activeByRole[m.role_name] ?? 0) + 1;
    }
    const teams = has(x.actor, 'teams:read') ? (await listTeams(x)).length : null;
    const projects = has(x.actor, 'projects:read') ? (await listProjects(x)).length : null;
    return { data: redactOverview(x.org, { activeByRole, teams, projects }) };
  },
};
