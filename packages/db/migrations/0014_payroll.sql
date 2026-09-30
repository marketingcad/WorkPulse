CREATE TABLE "payroll_profile_members" (
	"organization_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"bank_details_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_profile_members_profile_id_membership_id_pk" PRIMARY KEY("profile_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"period" jsonb NOT NULL,
	"currency" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_run_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"approved_seconds" integer DEFAULT 0 NOT NULL,
	"unapproved_seconds" integer DEFAULT 0 NOT NULL,
	"regular_seconds" integer DEFAULT 0 NOT NULL,
	"overtime_seconds" integer DEFAULT 0 NOT NULL,
	"time_pay_minor" bigint DEFAULT 0 NOT NULL,
	"time_off_hours" numeric(8, 2) DEFAULT 0 NOT NULL,
	"time_off_pay_minor" bigint DEFAULT 0 NOT NULL,
	"gross_minor" bigint DEFAULT 0 NOT NULL,
	"adjustments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"net_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_run_lines_runId_membershipId_unique" UNIQUE("run_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"gross_minor" bigint DEFAULT 0 NOT NULL,
	"adjustments_minor" bigint DEFAULT 0 NOT NULL,
	"net_minor" bigint DEFAULT 0 NOT NULL,
	"other_currency" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_profileId_periodStart_unique" UNIQUE("profile_id","period_start")
);
--> statement-breakpoint
CREATE INDEX "payroll_profile_members_organization_id_membership_id_index" ON "payroll_profile_members" USING btree ("organization_id","membership_id");--> statement-breakpoint
CREATE INDEX "payroll_run_lines_organization_id_membership_id_index" ON "payroll_run_lines" USING btree ("organization_id","membership_id");--> statement-breakpoint
CREATE INDEX "payroll_runs_organization_id_period_start_index" ON "payroll_runs" USING btree ("organization_id","period_start");--> statement-breakpoint
-- Existing organizations: the built-in admin role gets the new payroll permissions (new orgs get them from the preset).
-- role_permissions has FORCE row-level security, so this runs with the bypass on.
SELECT set_config('app.bypass_rls', 'on', false);--> statement-breakpoint
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission", "scope")
SELECT r."organization_id", r."id", p.permission, 'org' FROM "roles" r CROSS JOIN (VALUES ('payroll:read'), ('payroll:manage')) AS p(permission)
WHERE r."key" = 'SYSTEM_ADMIN' AND r."builtin"
ON CONFLICT DO NOTHING;--> statement-breakpoint
SELECT set_config('app.bypass_rls', 'off', false);