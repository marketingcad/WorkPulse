import { z } from 'zod';
import type { TrackingPolicy } from '@tallywork/domain';

/** Own-data resources the renderer may read (GET /api/v1/agent/me/<resource>). */
export const ME_RESOURCES = ['summary', 'sessions', 'timesheet', 'activity', 'tasks', 'schedule', 'time-off', 'notifications'] as const;
export type MeResource = (typeof ME_RESOURCES)[number];

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
  /** Own-data reads (the signed-in worker only). The path is built in main from this allowlist. */
  'me:get': z.object({
    resource: z.enum(ME_RESOURCES),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    date: z.iso.date().optional(),
  }),
  'me:submitTimesheet': z.object({ date: z.iso.date(), version: z.number().int().positive().optional() }),
  'me:requestTimeOff': z.object({ policy_id: z.uuid(), start_date: z.iso.date(), end_date: z.iso.date(), half_day: z.boolean().optional(), reason: z.string().trim().max(1000).optional() }),
  'me:readNotifications': z.object({ ids: z.union([z.literal('all'), z.array(z.uuid()).max(200)]) }),
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
  /** the server is set by the organization's device management and cannot be changed */
  serverManaged: boolean;
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
  /** Per-minute activity % for the last hour of tracking (this computer only), oldest first. */
  activityRecent: Array<{ minute: string; pct: number }>;
  /** What is being recorded right now while tracking (app name / website domain, as policy allows). */
  recordingNow: { app: string | null; domain: string | null } | null;
  idlePrompt: { idleId: string; startedAt: string; endedAt: string | null } | null;
  recoveryPrompt: { sessionId: string; lastEvidenceAt: string; projectName: string } | null;
  sync: { queued: number; lastSyncAt: string | null; online: boolean; error: string | null };
  capabilities: Record<string, boolean>;
  /** Browsers whose Tallywork extension is connected (Windows); others fall back to reading the address bar. */
  browserExtension: string[];
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
