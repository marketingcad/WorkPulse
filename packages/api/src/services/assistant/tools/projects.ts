import { z } from 'zod';
import { listProjects } from '../../work';
import { redactProject } from '../redact';
import { capOutput, has, nameArg } from './shared';
import type { AssistantTool } from './types';

const input = z
  .object({
    status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED']).optional(),
    client: nameArg.optional().describe('Client name'),
    q: z.string().trim().min(1).max(100).optional().describe('Part of a project name'),
  })
  .strict();

export const projectsTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getProjectSummary',
  description: 'Projects the person can see: name, client, status and total tracked hours. Filter by status, client name or part of the project name.',
  input,
  allowed: (a) => has(a, 'projects:read'),
  statusKey: 'checking_projects',
  async run(x, q) {
    let rows = await listProjects(x);
    if (q.status) rows = rows.filter((p) => p.status === q.status);
    if (q.client) {
      const c = q.client.toLowerCase();
      rows = rows.filter((p) => (p.client_name ?? '').toLowerCase().includes(c));
    }
    if (q.q) {
      const term = q.q.toLowerCase();
      rows = rows.filter((p) => p.name.toLowerCase().includes(term));
    }
    const out = capOutput(rows.map(redactProject));
    return { data: { rows: out.rows, truncated: out.truncated, total: rows.length } };
  },
};
