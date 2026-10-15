ALTER TABLE "billing_entries" ADD COLUMN "payroll_line_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_run_lines" ADD COLUMN "carried_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Link time already paid by finalized payrolls, so later runs do not pay it again. Only entries
-- that existed when the run was finalized were paid; anything approved after that stays unpaid
-- and is picked up by the next run. Entries in another currency were never paid by the run.
UPDATE "billing_entries" AS be
SET "payroll_line_id" = l."id"
FROM "payroll_run_lines" AS l
JOIN "payroll_runs" AS r ON r."id" = l."run_id"
WHERE r."status" IN ('FINALIZED', 'PAID')
  AND be."organization_id" = l."organization_id"
  AND be."membership_id" = l."membership_id"
  AND be."voided_at" IS NULL
  AND be."payroll_line_id" IS NULL
  AND be."local_date" BETWEEN r."period_start" AND r."period_end"
  AND be."created_at" <= coalesce(r."finalized_at", r."updated_at")
  AND (be."pay_rate_id" IS NULL OR EXISTS (SELECT 1 FROM "billing_rates" AS br WHERE br."id" = be."pay_rate_id" AND br."currency" = r."currency"));
