CREATE TABLE "email_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role_id" uuid NOT NULL,
	"team_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_organizationId_userId_unique" UNIQUE("organization_id","user_id"),
	CONSTRAINT "memberships_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "mfa_factors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"secret_enc" text NOT NULL,
	"verified_at" timestamp with time zone,
	"recovery_code_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"week_start" integer DEFAULT 1 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"pay_period" jsonb DEFAULT '{"type":"weekly"}'::jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"organization_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"scope" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_organizationId_key_unique" UNIQUE("organization_id","key"),
	CONSTRAINT "roles_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"avatar_url" text,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_profiles" (
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"tracking_enabled" boolean DEFAULT true NOT NULL,
	"title" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"employment_type" text DEFAULT 'EMPLOYEE' NOT NULL,
	"weekly_expected_seconds" integer,
	"start_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"role" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"currency" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "device_auth_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"code_challenge" text NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_auth_codes_codeHash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "device_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_credentials_refreshTokenHash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"os_version" text,
	"agent_version" text,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"public_key" text,
	"last_seen_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"clock_skew_ms" integer DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "policy_acks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"policy_hash" text NOT NULL,
	"device_id" uuid,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" text DEFAULT 'MEMBER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_membership_id_pk" PRIMARY KEY("project_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "project_teams" (
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	CONSTRAINT "project_teams_project_id_team_id_pk" PRIMARY KEY("project_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#4B4FC4' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"billable_default" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "task_assignees" (
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	CONSTRAINT "task_assignees_task_id_membership_id_pk" PRIMARY KEY("task_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'TODO' NOT NULL,
	"priority" text DEFAULT 'MEDIUM' NOT NULL,
	"due_date" text,
	"estimate_seconds" integer,
	"completed_at" timestamp with time zone,
	"external_ref" jsonb,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"organization_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" text DEFAULT 'MEMBER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_team_id_membership_id_pk" PRIMARY KEY("team_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "tracking_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"doc" jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_policies_organizationId_scopeType_scopeId_unique" UNIQUE("organization_id","scope_type","scope_id")
);
--> statement-breakpoint
CREATE TABLE "activity_minutes" (
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"minute_start" timestamp with time zone NOT NULL,
	"keyboard_count" integer DEFAULT 0 NOT NULL,
	"mouse_count" integer DEFAULT 0 NOT NULL,
	"active_seconds" smallint NOT NULL,
	"tracked_seconds" smallint DEFAULT 60 NOT NULL,
	CONSTRAINT "activity_minutes_session_id_minute_start_pk" PRIMARY KEY("session_id","minute_start")
);
--> statement-breakpoint
CREATE TABLE "activity_windows" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"session_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"active_seconds" integer NOT NULL,
	"tracked_seconds" integer NOT NULL,
	"keyboard_count" integer NOT NULL,
	"mouse_count" integer NOT NULL,
	"activity_pct" smallint NOT NULL,
	"keyboard_pct" smallint NOT NULL,
	"mouse_pct" smallint NOT NULL,
	"local_date" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_windows_membership_id_window_start_pk" PRIMARY KEY("membership_id","window_start")
);
--> statement-breakpoint
CREATE TABLE "app_spans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"device_id" uuid,
	"client_span_id" uuid NOT NULL,
	"app_name" text NOT NULL,
	"app_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idle_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"resolution" text DEFAULT 'PENDING' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"reassigned_task_id" uuid,
	"client_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_receipts" (
	"organization_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"client_event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_receipts_device_id_client_event_id_pk" PRIMARY KEY("device_id","client_event_id")
);
--> statement-breakpoint
CREATE TABLE "presence" (
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" text NOT NULL,
	"session_id" uuid,
	"project_id" uuid,
	"task_id" uuid,
	"activity_pct" smallint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rollup_app_day" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"local_date" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"project_id" uuid NOT NULL,
	"seconds" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "rollup_app_day_organization_id_membership_id_local_date_kind_name_project_id_pk" PRIMARY KEY("organization_id","membership_id","local_date","kind","name","project_id")
);
--> statement-breakpoint
CREATE TABLE "rollup_worker_day" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"local_date" text NOT NULL,
	"project_id" uuid NOT NULL,
	"task_key" text NOT NULL,
	"billable" boolean NOT NULL,
	"tracked_seconds" integer DEFAULT 0 NOT NULL,
	"manual_seconds" integer DEFAULT 0 NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"activity_tracked_seconds" integer DEFAULT 0 NOT NULL,
	"idle_seconds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rollup_worker_day_organization_id_membership_id_local_date_project_id_task_key_billable_pk" PRIMARY KEY("organization_id","membership_id","local_date","project_id","task_key","billable")
);
--> statement-breakpoint
CREATE TABLE "screenshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"device_id" uuid,
	"captured_at" timestamp with time zone NOT NULL,
	"display_index" smallint DEFAULT 0 NOT NULL,
	"storage_key" text NOT NULL,
	"thumb_key" text,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"sha256" text,
	"blurred" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'PENDING_UPLOAD' NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"trigger" text NOT NULL,
	"cause" text,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"session_id" uuid,
	"segment_id" uuid,
	"source" text NOT NULL,
	"tracking_source" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"local_date" text NOT NULL,
	"timezone" text NOT NULL,
	"billable" boolean NOT NULL,
	"note" text,
	"edited" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"locked_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "time_entry_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entry_revisions_timeEntryId_revision_unique" UNIQUE("time_entry_id","revision")
);
--> statement-breakpoint
CREATE TABLE "time_segments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"derived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tracking_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"device_id" uuid,
	"source" text NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"state" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"last_evidence_at" timestamp with time zone,
	"timezone" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_sessions_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "url_spans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"device_id" uuid,
	"client_span_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"url" text,
	"browser" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"comment" text,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_time_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"reason" text,
	"note" text,
	"billable" boolean NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"created_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	"time_entry_id" uuid,
	"client_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"timesheet_id" uuid NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"local_date" text NOT NULL,
	"duration_seconds" integer NOT NULL,
	"billable" boolean NOT NULL,
	"source" text NOT NULL,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"total_seconds" integer DEFAULT 0 NOT NULL,
	"billable_seconds" integer DEFAULT 0 NOT NULL,
	"manual_seconds" integer DEFAULT 0 NOT NULL,
	"comment" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheets_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "timesheets_organizationId_membershipId_periodStart_unique" UNIQUE("organization_id","membership_id","period_start")
);
--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"local_date" text NOT NULL,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"first_in" timestamp with time zone,
	"last_out" timestamp with time zone,
	"worked_seconds" integer DEFAULT 0 NOT NULL,
	"scheduled_seconds" integer DEFAULT 0 NOT NULL,
	"late_seconds" integer DEFAULT 0 NOT NULL,
	"early_leave_seconds" integer DEFAULT 0 NOT NULL,
	"overtime_seconds" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_days_membership_id_local_date_pk" PRIMARY KEY("membership_id","local_date")
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"date" text NOT NULL,
	"name" text NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_organizationId_date_unique" UNIQUE("organization_id","date")
);
--> statement-breakpoint
CREATE TABLE "overtime_rule_sets" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"rules" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"schedule_id" uuid,
	"local_date" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"kind" text DEFAULT 'SCHEDULED' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_off_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"hours" numeric(8, 2) NOT NULL,
	"kind" text NOT NULL,
	"request_id" uuid,
	"note" text,
	"effective_date" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_off_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"accrual" jsonb NOT NULL,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"hours_per_day" numeric(5, 2) DEFAULT 8 NOT NULL,
	"applies_to_all" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_off_policy_members" (
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	CONSTRAINT "time_off_policy_members_policy_id_membership_id_pk" PRIMARY KEY("policy_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "time_off_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"half_day" boolean DEFAULT false NOT NULL,
	"hours" numeric(8, 2) NOT NULL,
	"reason" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"name" text DEFAULT 'Standard' NOT NULL,
	"timezone" text NOT NULL,
	"days" jsonb NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"time_entry_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"timesheet_id" uuid,
	"membership_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"client_id" uuid,
	"task_id" uuid,
	"local_date" text NOT NULL,
	"seconds" integer NOT NULL,
	"billable" boolean NOT NULL,
	"bill_rate_id" uuid,
	"pay_rate_id" uuid,
	"bill_amount_minor" bigint DEFAULT 0 NOT NULL,
	"pay_amount_minor" bigint DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"invoice_line_id" uuid,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"effective_from" text NOT NULL,
	"effective_to" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"period" text DEFAULT 'TOTAL' NOT NULL,
	"warn_pct" integer DEFAULT 80 NOT NULL,
	"include_non_billable" boolean DEFAULT false NOT NULL,
	"start_date" text,
	"end_date" text,
	"last_notified_level" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_organizationId_subjectType_subjectId_unique" UNIQUE("organization_id","subject_type","subject_id")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"project_id" uuid,
	"client_id" uuid,
	"category" text NOT NULL,
	"description" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"spent_on" text NOT NULL,
	"receipt_file_id" uuid,
	"billable" boolean DEFAULT false NOT NULL,
	"reimbursable" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"reimbursed_at" timestamp with time zone,
	"invoice_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_objects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer,
	"sha256" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 4) NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"amount_minor" bigint NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"project_id" uuid,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"prefix" text DEFAULT 'INV-' NOT NULL,
	"next" integer DEFAULT 1001 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"number" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"issue_date" text NOT NULL,
	"due_date" text NOT NULL,
	"period_start" text,
	"period_end" text,
	"currency" text NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"sent_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_organizationId_number_unique" UNIQUE("organization_id","number")
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid,
	"provider" text DEFAULT 'manual' NOT NULL,
	"provider_ref" text,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"received_on" text NOT NULL,
	"status" text DEFAULT 'SUCCEEDED' NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_prefix_unique" UNIQUE("prefix")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb,
	"ip_address" text,
	"user_agent" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_layouts" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"widgets" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboard_layouts_membership_id_scope_pk" PRIMARY KEY("membership_id","scope")
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"principal" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_principal_key_pk" PRIMARY KEY("principal","key")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"type" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notification_preferences_membership_id_type_pk" PRIMARY KEY("membership_id","type")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_version" integer DEFAULT 1 NOT NULL,
	"envelope" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"report_key" text NOT NULL,
	"format" text NOT NULL,
	"params" jsonb NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"file_id" uuid,
	"row_count" integer,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"organization_id" uuid NOT NULL,
	"data_class" text NOT NULL,
	"keep_days" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_policies_organization_id_data_class_pk" PRIMARY KEY("organization_id","data_class")
);
--> statement-breakpoint
CREATE TABLE "saved_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"report_key" text NOT NULL,
	"name" text NOT NULL,
	"params" jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"schedule_cron" text,
	"schedule_timezone" text,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"response_status" integer,
	"response_body" text,
	"duration_ms" integer,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"secret_enc" text NOT NULL,
	"events" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_teams" ADD CONSTRAINT "project_teams_organization_id_team_id_teams_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_organization_id_task_id_tasks_organization_id_id_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organization_id_team_id_teams_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_policies" ADD CONSTRAINT "tracking_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_transitions" ADD CONSTRAINT "session_transitions_organization_id_session_id_tracking_sessions_organization_id_id_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."tracking_sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_organization_id_task_id_tasks_organization_id_id_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_revisions" ADD CONSTRAINT "time_entry_revisions_organization_id_time_entry_id_time_entries_organization_id_id_fk" FOREIGN KEY ("organization_id","time_entry_id") REFERENCES "public"."time_entries"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_segments" ADD CONSTRAINT "time_segments_organization_id_session_id_tracking_sessions_organization_id_id_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."tracking_sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_organization_id_task_id_tasks_organization_id_id_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_sessions" ADD CONSTRAINT "tracking_sessions_organization_id_device_id_devices_organization_id_id_fk" FOREIGN KEY ("organization_id","device_id") REFERENCES "public"."devices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_organization_id_timesheet_id_timesheets_organization_id_id_fk" FOREIGN KEY ("organization_id","timesheet_id") REFERENCES "public"."timesheets"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_organization_id_email_index" ON "invitations" USING btree ("organization_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_owner" ON "memberships" USING btree ("organization_id") WHERE "memberships"."is_owner";--> statement-breakpoint
CREATE INDEX "memberships_user_id_index" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_uq" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "user_sessions_user_id_index" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "clients_organization_id_archived_at_index" ON "clients" USING btree ("organization_id","archived_at");--> statement-breakpoint
CREATE INDEX "device_credentials_family_id_index" ON "device_credentials" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "devices_organization_id_status_index" ON "devices" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "devices_membership_id_index" ON "devices" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "policy_acks_organization_id_membership_id_index" ON "policy_acks" USING btree ("organization_id","membership_id");--> statement-breakpoint
CREATE INDEX "project_members_membership_id_index" ON "project_members" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "projects_organization_id_status_index" ON "projects" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "projects_organization_id_client_id_index" ON "projects" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE INDEX "task_assignees_membership_id_index" ON "task_assignees" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "tasks_organization_id_project_id_status_index" ON "tasks" USING btree ("organization_id","project_id","status");--> statement-breakpoint
CREATE INDEX "team_members_membership_id_index" ON "team_members" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "teams_organization_id_index" ON "teams" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "activity_minutes_organization_id_membership_id_minute_start_index" ON "activity_minutes" USING btree ("organization_id","membership_id","minute_start");--> statement-breakpoint
CREATE INDEX "activity_windows_organization_id_local_date_index" ON "activity_windows" USING btree ("organization_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "app_spans_client_uq" ON "app_spans" USING btree ("session_id","client_span_id");--> statement-breakpoint
CREATE INDEX "app_spans_organization_id_membership_id_started_at_index" ON "app_spans" USING btree ("organization_id","membership_id","started_at");--> statement-breakpoint
CREATE INDEX "idle_events_organization_id_membership_id_started_at_index" ON "idle_events" USING btree ("organization_id","membership_id","started_at");--> statement-breakpoint
CREATE INDEX "idle_events_session_id_index" ON "idle_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "rollup_app_day_organization_id_local_date_kind_index" ON "rollup_app_day" USING btree ("organization_id","local_date","kind");--> statement-breakpoint
CREATE INDEX "rollup_worker_day_organization_id_local_date_index" ON "rollup_worker_day" USING btree ("organization_id","local_date");--> statement-breakpoint
CREATE INDEX "screenshots_organization_id_membership_id_captured_at_index" ON "screenshots" USING btree ("organization_id","membership_id","captured_at");--> statement-breakpoint
CREATE INDEX "screenshots_session_id_index" ON "screenshots" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_transitions_session_id_index" ON "session_transitions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "time_entries_organization_id_membership_id_local_date_index" ON "time_entries" USING btree ("organization_id","membership_id","local_date");--> statement-breakpoint
CREATE INDEX "time_entries_organization_id_project_id_local_date_index" ON "time_entries" USING btree ("organization_id","project_id","local_date");--> statement-breakpoint
CREATE INDEX "time_entries_session_id_index" ON "time_entries" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "time_segments_session_id_index" ON "time_segments" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "time_segments_organization_id_membership_id_started_at_index" ON "time_segments" USING btree ("organization_id","membership_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_sessions_one_live" ON "tracking_sessions" USING btree ("organization_id","membership_id") WHERE "tracking_sessions"."state" in ('CREATED','ACTIVE','PAUSED','INTERRUPTED');--> statement-breakpoint
CREATE INDEX "tracking_sessions_organization_id_membership_id_started_at_index" ON "tracking_sessions" USING btree ("organization_id","membership_id","started_at");--> statement-breakpoint
CREATE INDEX "tracking_sessions_organization_id_state_index" ON "tracking_sessions" USING btree ("organization_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "url_spans_client_uq" ON "url_spans" USING btree ("session_id","client_span_id");--> statement-breakpoint
CREATE INDEX "url_spans_organization_id_membership_id_started_at_index" ON "url_spans" USING btree ("organization_id","membership_id","started_at");--> statement-breakpoint
CREATE INDEX "approval_actions_organization_id_subject_type_subject_id_index" ON "approval_actions" USING btree ("organization_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "manual_time_requests_organization_id_status_index" ON "manual_time_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "manual_time_requests_organization_id_membership_id_index" ON "manual_time_requests" USING btree ("organization_id","membership_id");--> statement-breakpoint
CREATE INDEX "timesheet_entries_timesheet_id_index" ON "timesheet_entries" USING btree ("timesheet_id");--> statement-breakpoint
CREATE INDEX "timesheets_organization_id_status_index" ON "timesheets" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "attendance_days_organization_id_local_date_index" ON "attendance_days" USING btree ("organization_id","local_date");--> statement-breakpoint
CREATE INDEX "shifts_organization_id_membership_id_local_date_index" ON "shifts" USING btree ("organization_id","membership_id","local_date");--> statement-breakpoint
CREATE INDEX "shifts_organization_id_local_date_index" ON "shifts" USING btree ("organization_id","local_date");--> statement-breakpoint
CREATE INDEX "time_off_ledger_organization_id_membership_id_policy_id_index" ON "time_off_ledger" USING btree ("organization_id","membership_id","policy_id");--> statement-breakpoint
CREATE INDEX "time_off_requests_organization_id_status_index" ON "time_off_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "time_off_requests_organization_id_membership_id_start_date_index" ON "time_off_requests" USING btree ("organization_id","membership_id","start_date");--> statement-breakpoint
CREATE INDEX "work_schedules_organization_id_membership_id_index" ON "work_schedules" USING btree ("organization_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_entries_active_uq" ON "billing_entries" USING btree ("time_entry_id") WHERE "billing_entries"."voided_at" is null;--> statement-breakpoint
CREATE INDEX "billing_entries_organization_id_client_id_local_date_index" ON "billing_entries" USING btree ("organization_id","client_id","local_date");--> statement-breakpoint
CREATE INDEX "billing_entries_organization_id_membership_id_local_date_index" ON "billing_entries" USING btree ("organization_id","membership_id","local_date");--> statement-breakpoint
CREATE INDEX "billing_rates_organization_id_kind_scope_scope_id_index" ON "billing_rates" USING btree ("organization_id","kind","scope","scope_id");--> statement-breakpoint
CREATE INDEX "expenses_organization_id_status_index" ON "expenses" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "expenses_organization_id_membership_id_spent_on_index" ON "expenses" USING btree ("organization_id","membership_id","spent_on");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_id_index" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_organization_id_client_id_index" ON "invoices" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE INDEX "invoices_organization_id_status_index" ON "invoices" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "payment_allocations_invoice_id_index" ON "payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_uq" ON "payments" USING btree ("provider","provider_ref") WHERE "payments"."provider_ref" is not null;--> statement-breakpoint
CREATE INDEX "payments_organization_id_received_on_index" ON "payments" USING btree ("organization_id","received_on");--> statement-breakpoint
CREATE INDEX "audit_logs_organization_id_created_at_index" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_organization_id_target_type_target_id_index" ON "audit_logs" USING btree ("organization_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "notifications_membership_id_read_at_created_at_index" ON "notifications" USING btree ("membership_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "report_runs_status_created_at_index" ON "report_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_status_next_attempt_at_index" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_index" ON "webhook_deliveries" USING btree ("endpoint_id","created_at");