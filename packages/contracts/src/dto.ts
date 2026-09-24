/**
 * Response DTOs shared by the API, the web app and the desktop agent.
 * snake_case on the wire; timestamps are ISO strings.
 */
import type { Grants, TrackingPolicy } from '@tallywork/domain';

export interface MeDto {
  user: { id: string; name: string; email: string; email_verified: boolean; mfa_enabled: boolean };
  organizations: Array<{ id: string; slug: string; name: string; role_key: string; role_name: string; membership_id: string; is_owner: boolean }>;
}

export interface OrgContextDto {
  organization: {
    id: string;
    slug: string;
    name: string;
    timezone: string;
    week_start: number;
    currency: string;
    pay_period: unknown;
    settings: Record<string, unknown>;
    is_demo: boolean;
  };
  membership: { id: string; role_key: string; role_name: string; is_owner: boolean; timezone: string; tracking_enabled: boolean };
  grants: Grants;
  managed_team_ids: string[];
}

export interface WorkerDto {
  id: string; // membership id
  user_id: string;
  name: string;
  email: string;
  role_id: string;
  role_key: string;
  role_name: string;
  status: string;
  is_owner: boolean;
  title: string | null;
  timezone: string;
  tracking_enabled: boolean;
  employment_type: string;
  weekly_expected_seconds: number | null;
  team_ids: string[];
  created_at: string;
}

export interface TeamDto {
  id: string;
  name: string;
  description: string | null;
  members: Array<{ membership_id: string; name: string; role: 'MANAGER' | 'MEMBER' }>;
  project_ids: string[];
  archived_at: string | null;
}

export interface ClientDto {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  currency: string | null;
  notes: string | null;
  project_count: number;
  archived_at: string | null;
  created_at: string;
}

export interface ProjectDto {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string | null;
  description: string | null;
  color: string;
  status: string;
  billable_default: boolean;
  member_ids: string[];
  team_ids: string[];
  archived_at: string | null;
  tracked_seconds?: number;
  budget?: BudgetStatusDto | null;
  created_at: string;
}

export interface TaskDto {
  id: string;
  project_id: string;
  project_name?: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  estimate_seconds: number | null;
  tracked_seconds?: number;
  assignee_ids: string[];
  completed_at: string | null;
  created_at: string;
}

export interface SessionDto {
  id: string;
  membership_id: string;
  worker_name?: string;
  device_id: string | null;
  source: string;
  project_id: string;
  project_name?: string;
  task_id: string | null;
  task_title?: string | null;
  state: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
  note: string | null;
  worked_seconds: number;
  /** seconds of the currently open WORK segment start, for live timers */
  current_segment_started_at: string | null;
}

export interface CurrentTrackingDto {
  session: SessionDto | null;
  today_seconds: number;
  week_seconds: number;
  limits: { daily_seconds: number | null; weekly_seconds: number | null };
  server_time: string;
}

export interface LiveWorkerDto {
  membership_id: string;
  name: string;
  status: 'WORKING' | 'IDLE' | 'OFFLINE';
  session_id: string | null;
  project_id: string | null;
  project_name: string | null;
  task_title: string | null;
  started_at: string | null;
  activity_pct: number | null;
  today_seconds: number;
  last_seen_at: string | null;
}

export interface TimeEntryDto {
  id: string;
  membership_id: string;
  worker_name?: string;
  project_id: string;
  project_name?: string;
  task_id: string | null;
  task_title?: string | null;
  session_id: string | null;
  source: 'TRACKED' | 'MANUAL';
  tracking_source: string | null;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  local_date: string;
  billable: boolean;
  note: string | null;
  edited: boolean;
  locked: boolean;
  activity_pct: number | null;
}

export interface ActivityBlockDto {
  window_start: string;
  project_id: string;
  project_name: string;
  task_title: string | null;
  activity_pct: number;
  keyboard_pct: number;
  mouse_pct: number;
  tracked_seconds: number;
  screenshots: Array<{ id: string; captured_at: string; display_index: number; blurred: boolean; thumb_url: string; full_url: string }>;
  idle: boolean;
  manual: boolean;
}

export interface ActivityDayDto {
  membership_id: string;
  date: string;
  timezone: string;
  total_seconds: number;
  avg_activity_pct: number;
  blocks: ActivityBlockDto[];
  timeline: Array<{ start: string; end: string; kind: 'WORK' | 'IDLE' | 'BREAK' | 'MANUAL'; project_id: string | null; color: string | null }>;
  apps: Array<{ name: string; seconds: number }>;
  urls: Array<{ name: string; seconds: number }>;
}

export interface UsageRowDto {
  name: string;
  seconds: number;
  pct: number;
  workers: number;
}

export interface TimesheetDto {
  id: string | null;
  membership_id: string;
  worker_name: string;
  period_start: string;
  period_end: string;
  status: string;
  submitted_at: string | null;
  decided_at: string | null;
  decided_by_name: string | null;
  comment: string | null;
  total_seconds: number;
  billable_seconds: number;
  manual_seconds: number;
  days: Array<{ date: string; seconds: number }>;
  projects: Array<{ project_id: string; project_name: string; task_id: string | null; task_title: string | null; days: Record<string, number>; total: number }>;
  expected_seconds: number | null;
  avg_activity_pct: number | null;
  version: number;
}

export interface ApprovalQueueItemDto {
  timesheet_id: string;
  membership_id: string;
  worker_name: string;
  period_start: string;
  period_end: string;
  status: string;
  submitted_at: string | null;
  total_seconds: number;
  manual_seconds: number;
  expected_seconds: number | null;
  avg_activity_pct: number | null;
  flags: string[];
}

export interface ManualTimeDto {
  id: string;
  membership_id: string;
  worker_name: string;
  project_id: string;
  project_name: string;
  task_id: string | null;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  reason: string | null;
  note: string | null;
  status: string;
  created_at: string;
}

export interface BudgetStatusDto {
  id: string;
  subject_type: 'PROJECT' | 'CLIENT';
  subject_id: string;
  subject_name: string;
  kind: 'HOURS' | 'MONEY';
  amount: number;
  spent: number;
  remaining: number;
  pct_used: number;
  state: 'healthy' | 'warning' | 'exceeded';
  projected: number | null;
  currency: string;
}

export interface DeviceDto {
  id: string;
  membership_id: string;
  worker_name: string;
  name: string;
  platform: string;
  os_version: string | null;
  agent_version: string | null;
  status: string;
  capabilities: Record<string, boolean | string>;
  last_seen_at: string | null;
  last_sync_at: string | null;
  created_at: string;
}

export interface EffectivePolicyDto {
  policy: TrackingPolicy;
  hash: string;
  layers: Array<{ scope: 'ORG' | 'TEAM' | 'WORKER'; scope_id: string; doc: unknown }>;
}

export interface AgentBootstrapDto {
  organization: { id: string; name: string; timezone: string };
  worker: { membership_id: string; name: string; email: string; timezone: string };
  device: { id: string; status: string };
  policy: TrackingPolicy;
  policy_hash: string;
  policy_acknowledged: boolean;
  assignments: Array<{ project_id: string; project_name: string; color: string; client_name: string | null; tasks: Array<{ id: string; title: string; status: string }> }>;
  current_session: { id: string; state: string; project_id: string; task_id: string | null; started_at: string } | null;
  today_seconds: number;
  week_seconds: number;
  server_time: string;
  min_agent_version: string;
}

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface AuditLogDto {
  id: string;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  before: unknown;
  after: unknown;
  ip_address: string | null;
  created_at: string;
}
