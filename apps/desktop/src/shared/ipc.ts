import { z } from 'zod';
import type { TrackingPolicy } from '@tallywork/domain';

/**
 * The ONLY messages the renderer may send to the main process.
 * Every payload is validated in main before use (see main/ipc.ts).
 */
export const IPC = {
  'state:get': z.void(),
  'auth:login': z.object({ serverUrl: z.url({ protocol: /^https?$/ }).max(300).optional() }),
  'auth:logout': z.void(),
  'timer:start': z.object({ projectId: z.uuid(), taskId: z.uuid().nullable() }),
  'timer:stop': z.void(),
  'timer:pause': z.void(),
  'timer:resume': z.void(),
  'timer:break': z.object({ breakTypeId: z.uuid().nullable() }),
  'timer:switch': z.object({ projectId: z.uuid(), taskId: z.uuid().nullable() }),
  'notes:set': z.object({ note: z.string().max(1000) }),
  'idle:resolve': z.object({ choice: z.enum(['KEPT', 'DISCARDED', 'REASSIGNED']), projectId: z.uuid().optional(), taskId: z.uuid().nullable().optional() }),
  'policy:ack': z.void(),
  'recovery:resolve': z.object({ resume: z.boolean() }),
  'manualTime:request': z.object({
    projectId: z.uuid(),
    taskId: z.uuid().nullable(),
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().max(500),
    note: z.string().max(1000).optional(),
  }),
  'app:openWeb': z.object({ path: z.string().max(200).regex(/^\/[\w\-/?=&.]*$/) }),
  'app:quit': z.void(),
} as const;

export type IpcChannel = keyof typeof IPC;
export type IpcPayload<C extends IpcChannel> = z.infer<(typeof IPC)[C]>;

export interface Assignment {
  project_id: string;
  project_name: string;
  color: string;
  client_name: string | null;
  tasks: Array<{ id: string; title: string; status: string }>;
}

export type TrackingState = 'stopped' | 'active' | 'paused';

export interface AgentState {
  phase: 'signed_out' | 'signing_in' | 'ready' | 'error';
  error: string | null;
  serverUrl: string;
  version: string;
  account: { name: string; email: string; organization: string; organizationId: string; membershipId: string; timezone: string } | null;
  device: { id: string; status: string } | null;
  policy: TrackingPolicy | null;
  policyHash: string | null;
  policyAcknowledged: boolean;
  assignments: Assignment[];
  tracking: {
    state: TrackingState;
    sessionId: string | null;
    projectId: string | null;
    taskId: string | null;
    startedAt: string | null;
    /** worked seconds before the current running segment */
    baseSeconds: number;
    /** when the current running segment started (null when not running) */
    segmentStartedAt: string | null;
    note: string;
  };
  todaySeconds: number;
  weekSeconds: number;
  activityPct: number | null;
  idlePrompt: { idleId: string; startedAt: string; endedAt: string | null } | null;
  recoveryPrompt: { sessionId: string; lastEvidenceAt: string; projectName: string } | null;
  sync: { queued: number; lastSyncAt: string | null; online: boolean; error: string | null };
  capabilities: Record<string, boolean>;
  lastProject: { projectId: string; taskId: string | null } | null;
  /** A timesheet waiting to be submitted (from the server). */
  timesheetDue: { periodStart: string; periodEnd: string; status: 'DRAFT' | 'REJECTED'; totalSeconds: number; overdue: boolean } | null;
  /** Recent manual time requests made on this device, newest first. */
  manualRequests: ManualRequest[];
  /** break types the organization offers */
  breakTypes: Array<{ id: string; name: string; paid: boolean; maxMinutes: number | null }>;
  /** break type of the current break, when paused on one */
  breakTypeId: string | null;
  /** current or next shift (today/tomorrow) */
  nextShift: { startsAt: string; endsAt: string } | null;
}

export interface ManualRequest {
  id: string;
  projectId: string;
  startedAt: string;
  endedAt: string;
  /** queued = saved on this computer, not yet delivered */
  status: 'queued' | 'sent' | 'rejected';
  message: string | null;
}
