CREATE TABLE IF NOT EXISTS "screenshot_cleanup_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"retention_days" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"cutoff" timestamp with time zone NOT NULL,
	"requested_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"scanned" integer DEFAULT 0 NOT NULL,
	"deleted" integer DEFAULT 0 NOT NULL,
	"objects_removed" integer DEFAULT 0 NOT NULL,
	"bytes_reclaimed" bigint DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"eligible_count" integer,
	"eligible_bytes" bigint,
	"oldest_eligible_at" timestamp with time zone,
	"newest_eligible_at" timestamp with time zone,
	"excluded_count" integer,
	"error" text,
	CONSTRAINT "screenshot_cleanup_runs_trigger_ck" CHECK ("trigger" in ('SCHEDULED', 'MANUAL', 'PREVIEW')),
	CONSTRAINT "screenshot_cleanup_runs_status_ck" CHECK ("status" in ('PREVIEWED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "screenshot_cleanup_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
	"enabled" boolean DEFAULT true NOT NULL,
	"retention_days" integer DEFAULT 30 NOT NULL,
	"frequency" text DEFAULT 'DAILY' NOT NULL,
	"run_at" text DEFAULT '02:00' NOT NULL,
	"weekday" smallint DEFAULT 0 NOT NULL,
	"timezone" text,
	"retry_failed" boolean DEFAULT true NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_policy_version" integer,
	"approved_preview_id" uuid,
	"next_run_at" timestamp with time zone,
	"last_run_id" uuid,
	"alert_key" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenshot_cleanup_settings_days_ck" CHECK ("retention_days" between 1 and 3650),
	CONSTRAINT "screenshot_cleanup_settings_frequency_ck" CHECK ("frequency" in ('DAILY', 'WEEKLY')),
	CONSTRAINT "screenshot_cleanup_settings_run_at_ck" CHECK ("run_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "screenshot_cleanup_settings_weekday_ck" CHECK ("weekday" between 0 and 6)
);
--> statement-breakpoint
ALTER TABLE "screenshots" ADD COLUMN IF NOT EXISTS "purge_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "screenshots" ADD COLUMN IF NOT EXISTS "purge_next_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "screenshots" ADD COLUMN IF NOT EXISTS "purge_error" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "screenshot_cleanup_runs_organization_id_started_at_index" ON "screenshot_cleanup_runs" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "screenshot_cleanup_runs_active_uq" ON "screenshot_cleanup_runs" USING btree ("organization_id") WHERE "screenshot_cleanup_runs"."status" = 'RUNNING';--> statement-breakpoint
-- Carry over each organization's existing screenshot retention period. "Kept forever" (36500 days)
-- becomes cleanup turned off. Nothing is approved: the first deletion still needs a preview and approval.
INSERT INTO "screenshot_cleanup_settings" ("organization_id", "enabled", "retention_days")
SELECT "organization_id",
       ("keep_days" < 36500 or "pending_keep_days" is not null),
       least(greatest(coalesce("pending_keep_days", "keep_days"), 1), 3650)
FROM "retention_policies"
WHERE "data_class" = 'SCREENSHOTS'
ON CONFLICT ("organization_id") DO NOTHING;
