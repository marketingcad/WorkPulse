/**
 * Response DTOs shared by the API, the web app and the desktop agent.
 * snake_case on the wire; timestamps are ISO strings.
 */
import type { Grants, TrackingPolicy } from '@tallywork/domain';

export interface MeDto {
  user: { id: string; name: string; email: string; email_verified: boolean; mfa_enabled: boolean; locale: string };
  organizations: Array<{ id: string; slug: string; name: string; role_key: string; role_name: string; membership_id: string; is_owner: boolean }>;
  /** client portals this person can open (they are a client viewer, not a member) */
  client_portals: Array<{ access_id: string; organization_name: string; client_name: string }>;
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
    logo: string | null;
    brief: string | null;
    tax_id: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    document_language: string | null;
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
  start_date: string | null;
  end_date: string | null;
  /** current personal hourly rates (minor units, workspace currency); absent without rates:read */
  pay_rate_minor?: number | null;
  bill_rate_minor?: number | null;
  team_ids: string[];
  created_at: string;
}

/**
 * A member for pickers and name lookups (GET /workers/options): the fields those need, without the
 * rates and team lists the full member record loads, so it stays light for large organizations.
 */
export type MemberOptionDto = Pick<WorkerDto, 'id' | 'name' | 'email' | 'role_name' | 'status' | 'title' | 'timezone' | 'tracking_enabled' | 'weekly_expected_seconds'>;

/** Time and money for a date range. Money fields are null without rates:read / billing:read. */
export interface InsightsDto {
  from: string;
  to: string;
  currency: string;
  money_visible: boolean;
  /** some time was priced in another currency and is left out of the money sums */
  other_currency: boolean;
  totals: {
    logged_seconds: number;
    billable_seconds: number;
    activity_pct: number | null;
    pay_minor: number | null;
    bill_minor: number | null;
    days_off: number;
    people_with_time: number;
    clients_with_time: number;
    projects_with_time: number;
    billable_clients: number;
    billable_projects: number;
    paid_people: number;
  };
  members: Array<{
    membership_id: string;
    name: string;
    title: string | null;
    logged_seconds: number;
    billable_seconds: number;
    activity_pct: number | null;
    pay_minor: number | null;
    bill_minor: number | null;
    days_off: number;
  }>;
  by_client: Array<{ client_id: string | null; name: string; seconds: number; billable_seconds: number; bill_minor: number | null }>;
  by_project: Array<{ project_id: string; name: string; color: string; client_name: string | null; seconds: number; billable_seconds: number; bill_minor: number | null }>;
  by_day: Array<{ date: string; seconds: number; billable_seconds: number; pay_minor: number | null; bill_minor: number | null }>;
}

/** Personal data; readable by the member and by admins with members:manage. */
export interface MemberDetailsDto {
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  personal_email: string | null;
  phone: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  postal_code: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  education: string | null;
  /** admin-only; omitted for the member themselves */
  notes?: string | null;
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
  contact_name: string | null;
  document_language: string | null;
  color: string | null;
  logo: string | null;
  /** current client-level hourly rates (minor units); absent without rates:read */
  bill_rate_minor?: number | null;
  pay_rate_minor?: number | null;
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
  billable_seconds?: number;
  budget?: BudgetStatusDto | null;
  short_name: string | null;
  start_date: string | null;
  end_date: string | null;
  estimate_seconds: number | null;
  estimate_unit: 'HOURS' | 'DAYS';
  /** rates currency: the client's, else the workspace's */
  currency: string;
  /** current project-level hourly rates (minor units); absent without rates:read */
  pay_rate_minor?: number | null;
  bill_rate_minor?: number | null;
  created_at: string;
}

export interface ProjectDocumentDto {
  id: string;
  name: string;
  content_type: string;
  bytes: number;
  uploaded_by_name: string | null;
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

/** Totals over every matching entry in the range, and per day, for the paged time entry list. */
export interface TimeEntryPageSummary {
  entries: number;
  seconds: number;
  billable_seconds: number;
  by_day: Array<{ date: string; entries: number; seconds: number; billable_seconds: number }>;
}

/** Hours per member and day, summed by the server (GET /time-entries/totals). */
export interface TimeEntryTotalRow {
  membership_id: string;
  date: string;
  seconds: number;
  billable_seconds: number;
  manual_seconds: number;
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
  time_type_id?: string | null;
  /** entered as a duration: started_at/ended_at are a placeholder slot, show the duration only */
  duration_only?: boolean;
  client_id?: string | null;
  client_name?: string | null;
  edited: boolean;
  locked: boolean;
  activity_pct: number | null;
}

export interface PayrollProfileDto {
  id: string;
  name: string;
  period: { type: 'weekly' } | { type: 'biweekly'; anchorDate: string } | { type: 'semimonthly' } | { type: 'monthly' };
  currency: string;
  is_default: boolean;
  archived_at: string | null;
  members: Array<{ membership_id: string; name: string; bank: { type: string; bank_name: string | null; account_last4: string | null } | null }>;
}

export interface BankDetailsDto {
  type: 'bank' | 'paypal' | 'wise' | 'other';
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  routing_number: string | null;
  iban: string | null;
  swift: string | null;
  notes: string | null;
}

export interface PayStubDto {
  id: string;
  run_id: string;
  membership_id: string;
  name: string;
  profile_name: string;
  period_start: string;
  period_end: string;
  currency: string;
  status: 'DRAFT' | 'FINALIZED' | 'PAID';
  approved_seconds: number;
  unapproved_seconds: number;
  /** approved time from earlier periods (approved after their payroll); included in approved_seconds */
  carried_seconds: number;
  regular_seconds: number;
  overtime_seconds: number;
  time_pay_minor: number;
  time_off_hours: number;
  time_off_pay_minor: number;
  gross_minor: number;
  adjustments: Array<{ label: string; amount_minor: number }>;
  net_minor: number;
  paid_at: string | null;
}

export interface PayrollRunDto {
  id: string;
  profile_id: string;
  profile_name: string;
  period_start: string;
  period_end: string;
  currency: string;
  status: 'DRAFT' | 'FINALIZED' | 'PAID';
  gross_minor: number;
  adjustments_minor: number;
  net_minor: number;
  notes: string | null;
  member_count: number;
  created_at: string;
  finalized_at: string | null;
  paid_at: string | null;
  /** some time was priced in another currency and is not part of this run */
  other_currency: boolean;
  lines?: PayStubDto[];
}

export interface TimeTypeDto {
  id: string;
  name: string;
  short_name: string;
  color: string;
  pay_coefficient: number;
  bill_coefficient: number;
  not_billable: boolean;
  is_default: boolean;
  archived_at: string | null;
}

export interface ActivityBlockDto {
  window_start: string;
  session_id: string | null;
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
  projects: Array<{ project_id: string; project_name: string; color?: string; task_id: string | null; task_title: string | null; days: Record<string, number>; total: number }>;
  expected_seconds: number | null;
  avg_activity_pct: number | null;
  version: number;
  /** time in the period added or changed after submission (not in the snapshot) */
  late_seconds: number;
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
  late_seconds: number;
  flags: string[];
}

export interface ManualTimeDto {
  id: string;
  membership_id: string;
  worker_name: string;
  project_id: string;
  project_name: string;
  task_id: string | null;
  task_title: string | null;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  reason: string | null;
  note: string | null;
  status: string;
  created_at: string;
}

/** Totals over every invoice matching the client and search filters (all statuses), for the paged invoice list. */
export interface InvoicePageSummary {
  /** invoices per status, plus ALL */
  counts: Record<'ALL' | 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'OVERDUE' | 'PAID' | 'VOID', number>;
  open_count: number;
  overdue_count: number;
  /** money in the organization's currency only; invoices in other currencies are counted but not summed */
  outstanding_minor: number;
  overdue_minor: number;
  collected_minor: number;
  currency: string;
}

/** Totals over every expense the person may see that matches the search, for the paged expense list. */
export interface ExpensePageSummary {
  /** expenses per status, plus ALL */
  counts: Record<'ALL' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REIMBURSED', number>;
  /** amount of the expenses matching the status filter too, in the organization's currency only */
  total_minor: number;
  currency: string;
}

export interface BudgetStatusDto {
  id: string;
  subject_type: 'PROJECT' | 'CLIENT';
  period: 'TOTAL' | 'MONTHLY';
  warn_pct: number;
  include_non_billable: boolean;
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
  /** Money budget shown to someone without billing access: only the percentage and state are real. */
  amounts_hidden?: boolean;
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
  /** A timesheet the worker should submit: the last period if still open, or the current one on its last day. */
  timesheet_due: TimesheetDueDto | null;
  /** current or next shift (today/tomorrow) for reminders */
  next_shift: { starts_at: string; ends_at: string } | null;
  break_types: Array<{ id: string; name: string; paid: boolean; max_minutes: number | null }>;
  server_time: string;
  min_agent_version: string;
}

export interface TimesheetDueDto {
  period_start: string;
  period_end: string;
  status: 'DRAFT' | 'REJECTED';
  total_seconds: number;
  overdue: boolean;
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

// ─── Client portal ───────────────────────────────────────────────────────────
export interface PortalSectionsDto {
  hours: boolean;
  tasks: boolean;
  activity: boolean;
  screenshots: boolean;
}

export interface ClientPortalSettingsDto {
  client_id: string;
  enabled: boolean;
  sections: PortalSectionsDto;
  project_ids: string[] | null;
  projects: Array<{ id: string; name: string }>;
  access: Array<{ id: string; email: string; name: string | null; status: 'INVITED' | 'ACTIVE' | 'REVOKED'; accepted_at: string | null; last_viewed_at: string | null }>;
  /** what the current admin may switch on */
  can_enable: { activity: boolean; screenshots: boolean };
}

export interface PortalListItemDto {
  access_id: string;
  organization_name: string;
  client_name: string;
}

export interface PortalSummaryDto {
  access_id: string | null; // null in the admin preview
  organization: { id: string; name: string };
  client: { id: string; name: string };
  sections: PortalSectionsDto;
  range: { from: string; to: string };
  totals: { tracked_seconds: number; manual_seconds: number; billable_seconds: number };
  projects: Array<{ id: string; name: string; color: string; status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED'; tracked_seconds: number; budget: { amount_seconds: number; used_seconds: number; pct_used: number } | null }>;
  /** present when sections.hours */
  workers: Array<{ membership_id: string; name: string; title: string | null; tracked_seconds: number; manual_seconds: number; activity_pct: number | null; tasks: Array<{ task_id: string | null; title: string; seconds: number }> }> | null;
  /** present when sections.hours */
  days: Array<{ date: string; seconds: number }> | null;
  /** present when sections.tasks */
  tasks: Array<{ id: string; project_id: string; title: string; status: 'TODO' | 'IN_PROGRESS' | 'DONE'; priority: string; due_date: string | null; estimate_seconds: number | null; tracked_seconds: number; assignees: string[] }> | null;
}

export interface PortalScreenshotDto {
  id: string;
  captured_at: string;
  worker_name: string;
  project_id: string;
  blurred: boolean;
  thumb_url: string;
  full_url: string;
}

/** Shown to a worker: clients that can see their monitoring data. */
export interface ClientVisibilityDto {
  clients: Array<{ client_name: string; activity: boolean; screenshots: boolean }>;
}
