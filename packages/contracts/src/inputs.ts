import { z } from 'zod';
import { PERMISSIONS, SCOPES, API_KEY_SCOPES } from '@tallywork/domain';
import { currency, hhmm, id, isoDate, isoDateTime, nonEmpty, optionalText, timeZone } from './common';

/**
 * Optional numbered paging for long lists. Sending `page` (1-based) switches a list endpoint's
 * response to `{ data, total, page, page_size, ... }`; without it the endpoint keeps returning a
 * plain array, so existing API clients are unaffected. `q` is a case-insensitive text search.
 */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(100).optional(),
});

export const DOCUMENT_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl'] as const;

/** square PNG/JPEG image as a data: URL (PNG/JPEG so it can be embedded in PDFs) */
const pdfSafeLogo = z
  .string()
  .max(140_000, 'Use a smaller image')
  .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/, 'Use a PNG or JPEG image');

// ─── Auth ────────────────────────────────────────────────────────────────────
export const password = z.string().min(10, 'Use at least 10 characters').max(200);

export const signupInput = z.object({
  name: nonEmpty(100),
  email: z.email().max(254),
  password,
  organization_name: nonEmpty(100).optional(),
  timezone: timeZone.optional(),
});
export const loginInput = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
  totp: z.string().regex(/^\d{6}$/).optional(),
  /** "Remember me": false keeps the sign-in only until the browser closes. */
  remember: z.boolean().default(true),
});
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
      /** members cannot change their own time older than this many days (null = no lock) */
      lockAfterDays: z.number().int().min(0).max(3650).nullable(),
      /** members cannot change their own time before this date (null = no lock) */
      lockBeforeDate: isoDate.nullable(),
      minDailySeconds: z.number().int().min(0).max(24 * 3600).nullable(),
      minWeeklySeconds: z.number().int().min(0).max(7 * 24 * 3600).nullable(),
      missingTimeReminder: z.boolean(),
      missingTimeCheckAt: hhmm,
      /** converts hours and days, e.g. for project estimates */
      workingHoursPerDay: z.number().min(1).max(24),
    })
    .partial()
    .optional(),
  logo: pdfSafeLogo.nullable().optional(),
  brief: optionalText(300),
  tax_id: optionalText(50),
  address: optionalText(500),
  phone: optionalText(50),
  email: z.email().max(254).optional().nullable(),
  document_language: z.enum(DOCUMENT_LANGUAGES).optional().nullable(),
});

export const inviteInput = z.object({
  email: z.email().max(254),
  name: nonEmpty(100).optional(),
  role_id: id,
  team_ids: z.array(id).max(50).default([]),
  team_role: z.enum(['MEMBER', 'MANAGER']).default('MEMBER'),
  project_ids: z.array(id).max(100).default([]),
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
  /** employment end ("date left") */
  end_date: isoDate.nullable().optional(),
  /** personal hourly rates in minor units (workspace currency); requires rates:manage. null clears, omitted leaves unchanged. */
  pay_rate_minor: z.number().int().min(0).max(100_000_000).optional().nullable(),
  bill_rate_minor: z.number().int().min(0).max(100_000_000).optional().nullable(),
});

export const memberDetailsInput = z.object({
  first_name: optionalText(100),
  last_name: optionalText(100),
  birth_date: isoDate.nullable().optional(),
  personal_email: z.email().max(254).optional().nullable(),
  phone: optionalText(50),
  country: optionalText(100),
  region: optionalText(100),
  city: optionalText(100),
  postal_code: optionalText(20),
  address: optionalText(500),
  emergency_contact_name: optionalText(150),
  emergency_contact_phone: optionalText(50),
  education: optionalText(1000),
  /** admin-only */
  notes: optionalText(5000),
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
  contact_name: optionalText(150),
  document_language: z.enum(DOCUMENT_LANGUAGES).optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  /** square PNG/JPEG/WebP as a data: URL, at most ~70 KB (it is included in every client list) */
  logo: z
    .string()
    .max(100_000, 'Use a smaller image')
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, 'Use a PNG, JPEG or WebP image')
    .optional()
    .nullable(),
  /** client-level hourly rates in minor units; requires rates:manage. null clears, omitted leaves unchanged. */
  bill_rate_minor: z.number().int().min(0).max(100_000_000).optional().nullable(),
  pay_rate_minor: z.number().int().min(0).max(100_000_000).optional().nullable(),
});

/** One planned break of a project: an organization break type, optionally at a time of day and for a set length. */
export const projectBreakInput = z.object({
  break_type_id: id,
  start_time: hhmm.nullable().optional(),
  duration_minutes: z.number().int().min(1).max(8 * 60).nullable().optional(),
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
  short_name: optionalText(20),
  start_date: isoDate.nullable().optional(),
  end_date: isoDate.nullable().optional(),
  /** planned effort in seconds (entered in hours or days) */
  estimate_seconds: z.number().int().min(0).max(100_000 * 3600).nullable().optional(),
  estimate_unit: z.enum(['HOURS', 'DAYS']).optional(),
  /** project-level hourly rates in minor units; requires rates:manage. null clears, omitted leaves unchanged. */
  pay_rate_minor: z.number().int().min(0).max(100_000_000).optional().nullable(),
  bill_rate_minor: z.number().int().min(0).max(100_000_000).optional().nullable(),
  /** planned breaks, in order; replaces the project's list when given */
  breaks: z.array(projectBreakInput).max(12).optional(),
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

// ─── Client portal ───────────────────────────────────────────────────────────
export const portalSectionsInput = z.object({ hours: z.boolean(), tasks: z.boolean(), activity: z.boolean(), screenshots: z.boolean() });

export const clientPortalSettingsInput = z.object({
  enabled: z.boolean().optional(),
  sections: portalSectionsInput.partial().optional(),
  /** null = all of the client's projects */
  project_ids: z.array(id).max(500).nullable().optional(),
});

export const clientPortalInviteInput = z.object({ email: z.email().max(254), name: optionalText(100) });

export const clientPortalAcceptInput = z.object({
  token: z.string().min(20).max(200),
  name: optionalText(100),
  password: password.optional(),
});

/** Dashboard range; at most 93 days. */
export const portalRangeInput = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.from <= r.to && (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 <= 93, { message: 'Choose a range of up to 93 days' });

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
  time_type_id: id.nullable().optional(),
  reason: optionalText(500),
  /** the revision the editor saw: a newer one is refused (stale_revision) instead of overwritten */
  revision: z.number().int().min(1).optional(),
});
export const timeEntrySplitInput = z.object({ at: isoDateTime, reason: optionalText(500) });
export const timeEntryDeleteInput = z.object({ reason: optionalText(500) });

export const manualTimeInput = z
  .object({
    membership_id: id.optional(), // managers may add for team members
    project_id: id,
    task_id: id.nullable().optional(),
    /** either a start and end … */
    started_at: isoDateTime.optional(),
    ended_at: isoDateTime.optional(),
    /** … or a day and a duration (placed in the first free slot that day) */
    local_date: isoDate.optional(),
    duration_seconds: z.number().int().min(60).max(24 * 3600).optional(),
    /** only this much of the time is billable; the rest is recorded as a separate non-billable entry */
    billable_seconds: z.number().int().min(0).max(24 * 3600).optional(),
    reason: optionalText(500),
    note: optionalText(1000),
    billable: z.boolean().optional(),
    time_type_id: id.nullable().optional(),
  })
  .refine((v) => (v.started_at && v.ended_at) || (v.local_date && v.duration_seconds), { message: 'Give a start and end, or a date and a duration', path: ['duration_seconds'] });

export const timeEntryBulkInput = z.object({
  ids: z.array(id).min(1).max(200),
  action: z.enum(['delete', 'set_billable', 'set_non_billable']),
  reason: optionalText(500),
});
export const decisionInput = z.object({ comment: optionalText(1000) });

// ─── Payroll ─────────────────────────────────────────────────────────────────
export const payPeriodConfig = z.discriminatedUnion('type', [
  z.object({ type: z.literal('weekly') }),
  z.object({ type: z.literal('biweekly'), anchorDate: isoDate }),
  z.object({ type: z.literal('semimonthly') }),
  z.object({ type: z.literal('monthly') }),
]);
export const payrollProfileInput = z.object({
  name: nonEmpty(100),
  period: payPeriodConfig,
  currency,
  is_default: z.boolean().optional(),
  member_ids: z.array(id).max(2000).default([]),
});
export const bankDetailsInput = z.object({
  type: z.enum(['bank', 'paypal', 'wise', 'other']),
  bank_name: optionalText(150),
  account_name: optionalText(150),
  account_number: optionalText(64),
  routing_number: optionalText(64),
  iban: optionalText(64),
  swift: optionalText(20),
  notes: optionalText(500),
});
export const payrollRunInput = z.object({
  profile_id: id,
  /** any date in the period to pay; defaults to the last completed period */
  date: isoDate.optional(),
  notes: optionalText(1000),
});
export const payAdjustmentsInput = z.object({
  adjustments: z.array(z.object({ label: nonEmpty(100), amount_minor: z.number().int().min(-1_000_000_000).max(1_000_000_000) })).max(20),
});

export const timeTypeInput = z.object({
  name: nonEmpty(60),
  short_name: nonEmpty(4),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** multiplies the pay rate for time of this type (e.g. 1.5 for overtime) */
  pay_coefficient: z.number().min(0).max(10),
  bill_coefficient: z.number().min(0).max(10),
  not_billable: z.boolean().optional(),
  is_default: z.boolean().optional(),
});

// ─── Idle / screenshots ──────────────────────────────────────────────────────
export const idleResolveInput = z
  .object({
    resolution: z.enum(['KEPT', 'DISCARDED', 'REASSIGNED']),
    task_id: id.optional(),
    project_id: id.optional(),
  })
  .refine((v) => v.resolution !== 'REASSIGNED' || !!v.project_id, { message: 'Choose the project to reassign the idle time to', path: ['project_id'] });

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
/** Draft invoices only: fix dates or notes without recreating the invoice. */
export const invoiceDraftUpdateInput = z.object({ issue_date: isoDate.optional(), due_date: isoDate.optional(), notes: optionalText(2000) });
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
export const screenshotCleanupInput = z.object({
  enabled: z.boolean(),
  retention_days: z.number().int().min(1).max(3650),
  frequency: z.enum(['DAILY', 'WEEKLY']),
  run_at: hhmm,
  weekday: z.number().int().min(0).max(6).default(0),
  /** null = the organization's time zone */
  timezone: timeZone.nullable(),
  retry_failed: z.boolean(),
});
export const screenshotCleanupApproveInput = z.object({ preview_id: id });
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
