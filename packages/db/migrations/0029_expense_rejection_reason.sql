-- Why an expense was rejected, by whom and when. Additive (nullable), re-runnable.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;--> statement-breakpoint
-- Expenses rejected before reasons existed: say so, rather than show an empty reason.
UPDATE "expenses" SET "rejection_reason" = 'Rejected before reasons were recorded.', "rejected_by" = "decided_by", "rejected_at" = "decided_at" WHERE "status" = 'REJECTED' AND "rejection_reason" IS NULL;
