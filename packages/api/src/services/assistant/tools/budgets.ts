import { z } from 'zod';
import { listBudgets } from '../../finance';
import { redactBudget } from '../redact';
import { capOutput, has, matchByName, nameArg, NO_PROJECT } from './shared';
import type { AssistantTool } from './types';

const input = z.object({ project: nameArg.optional().describe('Project (or client) name') }).strict();

export const budgetsTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getProjectBudgetSummary',
  description: 'Budget use for the projects the person can see: percent used and whether it is healthy, near the limit or over. Money amounts appear only for people allowed to see billing.',
  input,
  allowed: (a) => has(a, 'budgets:read'),
  statusKey: 'checking_budgets',
  async run(x, q) {
    // listBudgets applies scope and removes money unless the actor holds billing:read or rates:read.
    const list = (await listBudgets(x)).map((b) => ({ ...b, name: b.subject_name }));
    const rows = q.project ? matchByName(list, q.project) : list;
    const out = capOutput(rows.map(redactBudget));
    return { data: { rows: out.rows, truncated: out.truncated, ...(q.project && !rows.length ? { note: NO_PROJECT } : {}) } };
  },
};
