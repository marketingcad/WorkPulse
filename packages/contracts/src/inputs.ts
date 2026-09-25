import { z } from 'zod';
import { PERMISSIONS, SCOPES, API_KEY_SCOPES } from '@tallywork/domain';
import { currency, hhmm, id, isoDate, isoDateTime, nonEmpty, optionalText, timeZone } from './common';

// ─── Auth ────────────────────────────────────────────────────────────────────
export const password = z.string().min(10, 'Use at least 10 characters').max(200);

export const signupInput = z.object({
  name: nonEmpty(100),
  email: z.email().max(254),
  password,
  organization_name: nonEmpty(100).optional(),
  timezone: timeZone.optional(),
});
export const loginInput = z.object({ email: z.email().max(254), password: z.string().min(1).max(200), totp: z.string().regex(/^\d{6}$/).optional() });
export const forgotPasswordInput = z.object({ email: z.email().max(254) });
export const resetPasswordInput = z.object({ token: z.string().min(20).max(200), password });
export const changePasswordInput = z.object({ current_password: z.string().min(1).max(200), new_password: password });
export const totpVerifyInput = z.object({ code: z.string().regex(/^\d{6}$/) });

// ─── Organizations & people ──────────────────────────────────────────────────
export const createOrgInput = z.object({ name: nonEmpty(100), timezone: timeZone.default('UTC'), currency: currency.default('USD') });
export const updateOrgInput = z.object({
  name: nonEmpty(100).optional(),
  timezone: timeZone.optional(),
  week_start: z.number().int().min(0).max(6).optional(),
  currency: currency.optional(),
  pay_period: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('weekly') }),
      z.object({ type: z.literal('biweekly'), anchorDate: isoDate }),
      z.object({ type: z.literal('semimonthly') }),
      z.object({ type: z.literal('monthly') }),
    ])
    .optional(),
  settings: z
    .object({
      lateGraceMinutes: z.number().int().min(0).max(240),
      durationFormat: z.enum(['hm', 'clock', 'decimal']),
      budgetWarnPct: z.number().int().min(1).max(100),
      requireDeviceApproval: z.boolean(),
      enforceMfa: z.enum(['none', 'admins', 'all']),
      sessionTtlHours: z.number().int().min(1).max(24 * 90),
      /** CIDR ranges allowed to use this organization; empty = anywhere */
      ipAllowlist: z.array(z.string().trim().max(50)).max(50),
    })
    .partial()
    .optional(),
});

export const inviteInput = z.object({
  email: z.email().max(254),
  name: nonEmpty(100).optional(),
  role_id: id,
  team_ids: z.array(id).max(50).default([]),
});
export const acceptInviteInput = z.object({ token: z.string().min(20).max(200), name: nonEmpty(100).optional(), password: password.optional() });

export const updateWorkerInput = z.object({
  role_id: id.optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  title: optionalText(100),
  timezone: timeZone.optional(),
  tracking_enabled: z.boolean().optional(),
  employment_type: z.enum(['EMPLOYEE', 'CONTRACTOR']).optional(),
  weekly_expected_seconds: z.number().int().min(0).max(7 * 24 * 3600).nullable().optional(),
  /** employment start date; used for pro-rata time-off accruals */
  start_date: isoDate.nullable().optional(),
});

export const roleInput = z.object({
  name: nonEmpty(60),
  description: optionalText(300),
  grants: z.partialRecord(z.enum(PERMISSIONS), z.enum(SCOPES)),
});

export const teamInput = z.object({ name: nonEmpty(100), description: optionalText(500) });
export const teamMemberInput = z.object({ role: z.enum(['MANAGER', 'MEMBER']).default('MEMBER') });

export const clientInput = z.object({
  name: nonEmpty(150),
  email: z.email().max(254).optional().nullable(),
  phone: optionalText(50),
  address: optionalText(500),
  currency: currency.optional().nullable(),
  notes: optionalText(2000),
});

export const projectInput = z.object({
  name: nonEmpty(150),
  client_id: id.nullable().optional(),
  description: optionalText(2000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED']).optional(),
  billable_default: z.boolean().optional(),
  member_ids: z.array(id).max(1000).optional(),
  team_ids: z.array(id).max(100).optional(),
});

export const taskInput = z.object({
  title: nonEmpty(300),
  description: optionalText(5000),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
  due_date: isoDate.nullable().optional(),
  estimate_seconds: z.number().int().min(0).max(10_000 * 3600).nullable().optional(),
  assignee_ids: z.array(id).max(100).optional(),
});

// ─── Tracking policy (deep partial; server validates the merged result) ──────
export const policyDocInput = z
  .object({
    tracking: z
      .object({
        allowWeb: z.boolean(),
        allowDesktop: z.boolean(),
        singleTimer: z.enum(['supersede', 'reject']),
        maxPauseMinutes: z.number().int().min(1).max(24 * 60),
        recoveryWindowMinutes: z.number().int().min(1).max(240),
        heartbeatGraceSeconds: z.number().int().min(60).max(3600),
        maxOfflineHours: z.number().int().min(1).max(168),
      })
      .partial(),
    activity: z.object({ enabled: z.boolean() }).partial(),
    idle: z
      .object({
        enabled: z.boolean(),
        thresholdMinutes: z.number().int().min(1).max(120),
        behavior: z.enum(['prompt', 'pause', 'keep']),
        confirmationTimeoutMinutes: z.number().int().min(1).max(240),
        defaultResolution: z.enum(['keep', 'discard']),
      })
      .partial(),
    screenshots: z
      .object({
        enabled: z.boolean(),
        perTenMinutes: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
        blur: z.boolean(),
        notify: z.boolean(),
        workerCanDelete: z.boolean(),
        deleteRemovesTime: z.boolean(),
      })
      .partial(),
    apps: z.object({ enabled: z.boolean() }).partial(),
    urls: z
      .object({
        enabled: z.boolean(),
        mode: z.enum(['domain', 'full']),
        excludedDomains: z.array(z.string().trim().toLowerCase().max(253)).max(500),
      })
      .partial(),
    location: z.object({ enabled: z.boolean() }).partial(),
    limits: z
      .object({
        dailySeconds: z.number().int().min(0).max(24 * 3600).nullable(),
        weeklySeconds: z.number().int().min(0).max(7 * 24 * 3600).nullable(),
      })
      .partial(),
    manualTime: z.object({ allowed: z.boolean(), requiresApproval: z.boolean(), reasonRequired: z.boolean() }).partial(),
    timeEdits: z.object({ workerCanEdit: z.boolean(), reasonRequired: z.boolean() }).partial(),
  })
  .partial();

// ─── Tracking commands (web/API) ─────────────────────────────────────────────
export const startTrackingInput = z.object({
  project_id: id,
  task_id: id.nullable().optional(),
  note: optionalText(1000),
  source: z.enum(['WEB', 'API']).default('WEB'),
});
export const switchTaskInput = z.object({ project_id: id, task_id: id.nullable().optional() });
export const sessionNoteInput = z.object({ note: z.string().max(1000) });

// ─── Time entries / manual time ──────────────────────────────────────────────
export const timeEntryUpdateInput = z.object({
  started_at: isoDateTime.optional(),
  ended_at: isoDateTime.optional(),
  project_id: id.optional(),
  task_id: id.nullable().optional(),
  billable: z.boolean().optional(),
  note: optionalText(1000),
  reason: optionalText(500),
});
export const timeEntrySplitInput = z.object({ at: isoDateTime, reason: optionalText(500) });
export const timeEntryDeleteInput = z.object({ reason: optionalText(500) });

export const manualTimeInput = z.object({
  membership_id: id.optional(), // managers may add for team members
  project_id: id,
  task_id: id.nullable().optional(),
  started_at: isoDateTime,
  ended_at: isoDateTime,
  reason: optionalText(500),
  note: optionalText(1000),
  billable: z.boolean().optional(),
});
export const decisionInput = z.object({ comment: optionalText(1000) });

// ─── Idle / screenshots ──────────────────────────────────────────────────────
export const idleResolveInput = z.object({
  resolution: z.enum(['KEPT', 'DISCARDED', 'REASSIGNED']),
  task_id: id.optional(),
  project_id: id.optional(),
});

// ─── Operations ──────────────────────────────────────────────────────────────
export const scheduleInput = z.object({
  membership_id: id,
  name: nonEmpty(60).default('Standard'),
  timezone: timeZone,
  days: z.array(z.object({ dow: z.number().int().min(0).max(6), start: hhmm, end: hhmm })).max(14),
  effective_from: isoDate,
  effective_to: isoDate.nullable().optional(),
});
export const holidayInput = z.object({ date: isoDate, name: nonEmpty(100), paid: z.boolean().default(true) });
export const timeOffPolicyInput = z.object({
  name: nonEmpty(100),
  paid: z.boolean().default(true),
  requires_approval: z.boolean().default(true),
  hours_per_day: z.number().min(1).max(24).default(8),
  accrual: z.object({
    type: z.enum(['none', 'annual', 'monthly', 'per_hour_worked']),
    amountHours: z.number().min(0).max(1000),
    maxBalanceHours: z.number().min(0).max(10_000).nullable(),
    carryOverHours: z.number().min(0).max(10_000).nullable(),
  }),
  applies_to_all: z.boolean().default(true),
  member_ids: z.array(id).optional(),
});
export const timeOffRequestInput = z.object({
  policy_id: id,
  start_date: isoDate,
  end_date: isoDate,
  half_day: z.boolean().default(false),
  reason: optionalText(1000),
});
export const timeOffAdjustInput = z.object({ policy_id: id, membership_id: id, hours: z.number().min(-1000).max(1000), note: optionalText(300) });

// ─── Finance ─────────────────────────────────────────────────────────────────
export const rateInput = z.object({
  kind: z.enum(['PAY', 'BILL']),
  scope: z.enum(['ORG', 'CLIENT', 'PROJECT', 'WORKER', 'PROJECT_WORKER']),
  scope_id: z.string().max(80).nullable().optional(),
  amount_minor: z.number().int().min(0).max(100_000_000),
  currency,
  effective_from: isoDate,
});
export const budgetInput = z.object({
  subject_type: z.enum(['PROJECT', 'CLIENT']),
  subject_id: id,
  kind: z.enum(['HOURS', 'MONEY']),
  amount: z.number().int().min(1),
  period: z.enum(['TOTAL', 'MONTHLY']).default('TOTAL'),
  warn_pct: z.number().int().min(1).max(100).default(80),
  include_non_billable: z.boolean().default(false),
});
export const expenseInput = z.object({
  project_id: id.nullable().optional(),
  client_id: id.nullable().optional(),
  category: nonEmpty(60),
  description: optionalText(1000),
  amount_minor: z.number().int().min(1).max(100_000_000),
  currency,
  spent_on: isoDate,
  receipt_file_id: id.nullable().optional(),
  billable: z.boolean().default(false),
  reimbursable: z.boolean().default(true),
});
export const invoiceCreateInput = z.object({
  client_id: id,
  period_start: isoDate,
  period_end: isoDate,
  issue_date: isoDate,
  due_date: isoDate,
  group_by: z.enum(['project', 'task', 'worker']).default('project'),
  tax_rate_bps: z.number().int().min(0).max(10_000).default(0),
  include_expenses: z.boolean().default(true),
  notes: optionalText(2000),
  extra_lines: z
    .array(z.object({ description: nonEmpty(300), quantity: z.number().min(0), unit_price_minor: z.number().int().min(0), tax_rate_bps: z.number().int().min(0).max(10_000).default(0) }))
    .max(100)
    .default([]),
});
export const paymentInput = z.object({
  client_id: id.nullable().optional(),
  amount_minor: z.number().int().min(1),
  currency,
  received_on: isoDate,
  provider: z.string().max(40).default('manual'),
  provider_ref: z.string().max(200).nullable().optional(),
  note: optionalText(500),
  allocations: z.array(z.object({ invoice_id: id, amount_minor: z.number().int().min(1) })).max(100).default([]),
});

// ─── Platform ────────────────────────────────────────────────────────────────
export const apiKeyInput = z.object({
  name: nonEmpty(100),
  scopes: z.array(z.enum(Object.keys(API_KEY_SCOPES) as [keyof typeof API_KEY_SCOPES, ...Array<keyof typeof API_KEY_SCOPES>])).min(1),
  expires_at: isoDateTime.nullable().optional(),
});
export const webhookInput = z.object({
  url: z.url().max(2000).refine((u) => u.startsWith('https://'), 'Webhook URLs must use https'),
  description: optionalText(300),
  events: z.array(z.string().max(80)).min(1).max(100),
  enabled: z.boolean().default(true),
});
export const retentionInput = z.object({
  policies: z.array(
    z.object({
      data_class: z.enum(['SCREENSHOTS', 'ACTIVITY', 'APPS', 'URLS', 'SESSIONS', 'TIMESHEETS', 'INVOICES', 'AUDIT', 'LOCATION']),
      keep_days: z.number().int().min(1).max(36500),
    }),
  ),
});
export const dashboardLayoutInput = z.object({
  scope: z.enum(['ALL', 'ME', 'WORKER']),
  widgets: z.array(z.object({ key: z.string().max(60), size: z.enum(['S', 'M', 'L']), settings: z.record(z.string(), z.unknown()).optional() })).max(40),
});
export const reportQueryInput = z.object({
  from: isoDate,
  to: isoDate,
  membership_ids: z.array(id).max(500).optional(),
  team_ids: z.array(id).max(100).optional(),
  project_ids: z.array(id).max(500).optional(),
  client_ids: z.array(id).max(500).optional(),
  group_by: z.array(z.string().max(30)).max(3).optional(),
  billable: z.enum(['all', 'billable', 'non_billable']).default('all'),
  status: z.string().max(30).optional(),
});
export const exportInput = reportQueryInput.extend({ format: z.enum(['CSV', 'XLSX', 'PDF']) });
export const savedReportInput = z.object({
  report_key: z.string().max(60),
  name: nonEmpty(100),
  params: z.record(z.string(), z.unknown()),
  shared: z.boolean().default(false),
  schedule_cron: z.string().max(100).nullable().optional(),
  schedule_timezone: timeZone.nullable().optional(),
  recipients: z.array(z.email()).max(20).default([]),
});

export const breakTypeInput = z.object({
  name: nonEmpty(60),
  paid: z.boolean().default(false),
  max_minutes: z.number().int().min(1).max(24 * 60).nullable().optional(),
});

const hours = (max: number) => z.number().int().min(3600).max(max * 3600).nullable();
export const overtimeRulesInput = z.object({
  /** overtime after this many seconds in one day (null = no daily rule) */
  daily_threshold_seconds: hours(24),
  /** overtime after this many regular seconds in one week (null = no weekly rule) */
  weekly_threshold_seconds: hours(168),
});

export const pauseInput = z.object({ break_type_id: z.uuid().nullable().optional() }).default({});
