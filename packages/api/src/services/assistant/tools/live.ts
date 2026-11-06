import { z } from 'zod';
import { liveWorkers } from '../../timer';
import { redactLiveWorker } from '../redact';
import { capOutput, has } from './shared';
import type { AssistantTool } from './types';

const input = z.object({}).strict();

export const liveTool: AssistantTool<z.infer<typeof input>> = {
  name: 'getLiveTrackingSummary',
  description: 'Who has a timer open right now, for the people the person can see: name, working or paused, project, task, and how many minutes ago the session started (pauses included).',
  input,
  allowed: (a) => has(a, 'tracking:read'),
  statusKey: 'checking_live_tracking',
  async run(x) {
    const all = await liveWorkers(x);
    const now = x.deps.now();
    // An open session is WORKING (running) or IDLE (paused on idle or a break); OFFLINE has none.
    const open = all.filter((w) => w.session_id !== null && w.status !== 'OFFLINE');
    const working = open.filter((w) => w.status === 'WORKING').length;
    const out = capOutput(open.map((w) => redactLiveWorker(w, now)));
    return { data: { rows: out.rows, truncated: out.truncated, tracking_now: working, paused: open.length - working, not_tracking: all.length - open.length } };
  },
};
