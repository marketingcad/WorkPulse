import { z } from 'zod';
import { listTeams } from '../../work';
import { redactTeam } from '../redact';
import { capOutput, has } from './shared';
import type { AssistantTool } from './types';

const input = z.object({}).strict();

export const teamsTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getTeamSummary',
  description: 'Teams the person can see: team name, manager names and member count.',
  input,
  allowed: (a) => has(a, 'teams:read'),
  statusKey: 'checking_teams',
  async run(x) {
    const out = capOutput((await listTeams(x)).map(redactTeam));
    return { data: { rows: out.rows, truncated: out.truncated } };
  },
};
