ALTER TABLE "time_entries" ADD COLUMN "duration_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "manual_time_requests" ADD COLUMN "billable_seconds" integer;--> statement-breakpoint
ALTER TABLE "manual_time_requests" ADD COLUMN "duration_only" boolean DEFAULT false NOT NULL;