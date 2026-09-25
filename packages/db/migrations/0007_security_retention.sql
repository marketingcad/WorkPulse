ALTER TABLE "users" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD COLUMN "pending_keep_days" integer;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD COLUMN "pending_from" timestamp with time zone;