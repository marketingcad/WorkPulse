CREATE TABLE "time_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"color" text DEFAULT '#475569' NOT NULL,
	"pay_coefficient" numeric(6, 3) DEFAULT 1 NOT NULL,
	"bill_coefficient" numeric(6, 3) DEFAULT 1 NOT NULL,
	"not_billable" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_sends" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reminder_date" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_sends_membership_id_kind_reminder_date_pk" PRIMARY KEY("membership_id","kind","reminder_date")
);
--> statement-breakpoint
ALTER TABLE "rollup_worker_day" ADD COLUMN "pay_weighted_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rollup_worker_day" ADD COLUMN "bill_weighted_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "time_type_id" uuid;--> statement-breakpoint
ALTER TABLE "manual_time_requests" ADD COLUMN "time_type_id" uuid;--> statement-breakpoint
ALTER TABLE "timesheet_entries" ADD COLUMN "time_type_id" uuid;--> statement-breakpoint
-- No time types exist yet, so every coefficient is 1: weighted seconds equal the plain total.
-- Tenant tables FORCE row-level security (owner included), so the backfill runs with the bypass on.
SELECT set_config('app.bypass_rls', 'on', false);--> statement-breakpoint
UPDATE "rollup_worker_day" SET "pay_weighted_seconds" = "tracked_seconds" + "manual_seconds", "bill_weighted_seconds" = "tracked_seconds" + "manual_seconds";--> statement-breakpoint
SELECT set_config('app.bypass_rls', 'off', false);