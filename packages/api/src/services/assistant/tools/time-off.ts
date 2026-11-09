import { z } from 'zod';
import { listTimeOffRequests } from '../../operations';
import { redactTimeOff } from '../redact';
import { capOutput, dateRange, has } from './shared';
import type { AssistantTool } from './types';

const input = dateRange({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional() });

export const timeOffTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getTimeOffSummary',
  description: 'Time off overlapping a date range (at most 93 days) for the people the person can see: name, policy, dates and status. Reasons are never included.',
  input,
  allowed: (a) => has(a, 'time_off:read'),
  statusKey: 'checking_time_off',
  async run(x, q) {
    const rows = await listTimeOffRequests(x, { from: q.from, to: q.to, status: q.status });
    const out = capOutput(rows.map(redactTimeOff));
    return { data: { from: q.from, to: q.to, rows: out.rows, truncated: out.truncated, total: rows.length } };
  },
};
