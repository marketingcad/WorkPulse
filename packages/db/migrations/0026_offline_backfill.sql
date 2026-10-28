-- Offline sync (audit 28 Oct 2026, phase 2). Additive and re-runnable: two flags on tracking sessions,
-- the one-live rule leaving backfill sessions out, and the table of time kept but flagged for review.
ALTER TABLE "tracking_sessions" ADD COLUMN IF NOT EXISTS "backfill" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tracking_sessions" ADD COLUMN IF NOT EXISTS "recorded_offline" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "tracking_sessions_one_live";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tracking_sessions_one_live" ON "tracking_sessions" USING btree ("organization_id","membership_id") WHERE "tracking_sessions"."state" in ('CREATED','ACTIVE','PAUSED','INTERRUPTED') and "tracking_sessions"."backfill" = false;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_review_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"local_date" text NOT NULL,
	"reason" text NOT NULL,
	"session_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_review_flags_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "time_review_flags_day_reason_uq" ON "time_review_flags" USING btree ("organization_id","membership_id","local_date","reason");
