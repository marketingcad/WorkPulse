import { z } from 'zod';
import { liveWorkers } from '../../timer';
import { redactLiveWorker } from '../redact';
import { capOutput, has } from './shared';
import type { AssistantTool } from './types';

const input = z.object({}).strict();

export const liveTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getLiveTrackingSummary',
  description: 'Who is tracking time right now: name, project, task and minutes in the current session, for the people the person can see.',
  input,
  allowed: (a) => has(a, 'tracking:read'),
  statusKey: 'checking_live_tracking',
  async run(x) {
    const all = await liveWorkers(x);
    const now = x.deps.now();
    const tracking = all.filter((w) => w.session_id !== null);
    const out = capOutput(tracking.map((w) => redactLiveWorker(w, now)));
    return { data: { rows: out.rows, truncated: out.truncated, tracking_now: tracking.length, not_tracking: all.length - tracking.length } };
  },
};
