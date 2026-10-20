-- Idempotent: the production database already had this column (added before this migration was
-- recorded), and the first deploy failed on a plain ADD COLUMN. Safe to run again.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tour_done_at" timestamp with time zone;--> statement-breakpoint
-- The product tour starts on its own for first-time users only: everyone who already has an
-- account counts as having seen it (they can start it any time from Help).
UPDATE "users" SET "tour_done_at" = now() WHERE "tour_done_at" IS NULL;
