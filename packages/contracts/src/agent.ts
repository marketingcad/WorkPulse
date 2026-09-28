import { z } from 'zod';
import { id, isoDateTime } from './common';

/**
 * Desktop agent → server ingest contract. The agent generates session ids (UUIDv7)
 * so sessions started offline keep stable identities; every event has a unique
 * event_id used for idempotent processing.
 */

const base = {
  event_id: id,
  session_id: id,
  occurred_at: isoDateTime,
};

/** Per-session monotonic sequence number for state commands. */
const seq = z.number().int().min(1).max(2_000_000_000);

export const agentEvent = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('session.start'), seq, project_id: id, task_id: id.nullable().optional(), note: z.string().max(1000).optional() }),
  z.object({ ...base, type: z.literal('session.pause'), seq, kind: z.enum(['IDLE', 'BREAK', 'MANUAL']).default('MANUAL'), break_type_id: id.nullable().optional() }),
  z.object({ ...base, type: z.literal('session.resume'), seq }),
  z.object({ ...base, type: z.literal('session.stop'), seq }),
  z.object({ ...base, type: z.literal('session.interrupted'), seq, last_evidence_at: isoDateTime, cause: z.enum(['sleep', 'shutdown', 'crash', 'lock', 'network']) }),
  z.object({ ...base, type: z.literal('session.recover'), seq }),
  z.object({ ...base, type: z.literal('session.note'), note: z.string().max(1000) }),
  z.object({
    ...base,
    type: z.literal('activity.minutes'),
    minutes: z
      .array(
        z.object({
          minute_start: isoDateTime,
          keyboard: z.number().int().min(0).max(100_000),
          mouse: z.number().int().min(0).max(100_000),
          active_seconds: z.number().int().min(0).max(60),
          tracked_seconds: z.number().int().min(0).max(60).default(60),
        }),
      )
      .min(1)
      .max(600),
  }),
  z.object({ ...base, type: z.literal('idle.started'), idle_id: id, started_at: isoDateTime }),
  z.object({
    ...base,
    type: z.literal('idle.resolved'),
    idle_id: id,
    started_at: isoDateTime,
    ended_at: isoDateTime,
    resolution: z.enum(['KEPT', 'DISCARDED', 'REASSIGNED']),
    task_id: id.nullable().optional(),
    project_id: id.nullable().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('app.spans'),
    spans: z
      .array(z.object({ span_id: id, app_name: z.string().min(1).max(200), app_id: z.string().max(300).nullable().optional(), started_at: isoDateTime, ended_at: isoDateTime }))
      .min(1)
      .max(500),
  }),
  z.object({
    ...base,
    type: z.literal('url.spans'),
    spans: z
      .array(
        z.object({
          span_id: id,
          domain: z.string().min(1).max(253),
          url: z.string().max(2048).nullable().optional(),
          browser: z.string().max(60).nullable().optional(),
          started_at: isoDateTime,
          ended_at: isoDateTime,
        }),
      )
      .min(1)
      .max(500),
  }),
  z.object({
    ...base,
    type: z.literal('screenshot.captured'),
    screenshot_id: id,
    captured_at: isoDateTime,
    display_index: z.number().int().min(0).max(16),
    blurred: z.boolean(),
    width: z.number().int().min(1).max(20_000),
    height: z.number().int().min(1).max(20_000),
    bytes: z.number().int().min(1).max(20_000_000),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    storage_key: z.string().max(300),
  }),
  /** Queued while offline too; event_id becomes the request id. Times are what the worker entered, so no skew correction. */
  z.object({
    event_id: id,
    occurred_at: isoDateTime,
    type: z.literal('manual_time.request'),
    project_id: id,
    task_id: id.nullable().optional(),
    started_at: isoDateTime,
    ended_at: isoDateTime,
    reason: z.string().trim().min(1).max(500).optional(),
    note: z.string().max(1000).optional(),
  }),
]);
export type AgentEvent = z.infer<typeof agentEvent>;

export const ingestBatchInput = z.object({
  /** device wall clock when the batch was sent — used to compute clock skew */
  sent_at: isoDateTime,
  events: z.array(agentEvent).min(1).max(500),
});
export type IngestBatchInput = z.infer<typeof ingestBatchInput>;

export interface IngestResult {
  event_id: string;
  status: 'accepted' | 'duplicate' | 'rejected';
  code?: string;
  message?: string;
}

export interface IngestResponse {
  results: IngestResult[];
  server_time: string;
  clock_skew_ms: number;
  session: AgentSessionState | null;
  policy_hash: string;
}

export interface AgentSessionState {
  id: string;
  state: string;
  project_id: string;
  task_id: string | null;
  started_at: string;
  end_reason: string | null;
}

export const heartbeatInput = z.object({
  sent_at: isoDateTime,
  session_id: id.nullable().optional(),
  agent_version: z.string().max(40).optional(),
  capabilities: z.record(z.string(), z.union([z.boolean(), z.string().max(100)])).optional(),
});

export const agentRegisterInput = z.object({
  code: z.string().min(20).max(200),
  code_verifier: z.string().min(43).max(128),
  device: z.object({
    name: z.string().min(1).max(100),
    platform: z.enum(['windows', 'macos', 'linux']),
    os_version: z.string().max(100).optional(),
    agent_version: z.string().max(40),
    capabilities: z.record(z.string(), z.union([z.boolean(), z.string().max(100)])).default({}),
    public_key: z.string().max(200).optional(),
  }),
});

/** Desktop sign-in with the account's email and password (plus a 2FA code when the account has one). */
export const agentLoginInput = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
  mfa_code: z.string().trim().min(6).max(20).optional(),
  organization_id: id.optional(),
  device: agentRegisterInput.shape.device,
});

export const agentRefreshInput = z.object({ refresh_token: z.string().min(20).max(300) });

export const screenshotUploadInput = z.object({
  screenshot_id: id,
  session_id: id,
  captured_at: isoDateTime,
  content_type: z.enum(['image/webp', 'image/jpeg', 'image/png']),
  bytes: z.number().int().min(1).max(20_000_000),
});

export const deviceAuthorizeInput = z.object({
  code_challenge: z.string().min(43).max(128),
  organization_id: id,
});
