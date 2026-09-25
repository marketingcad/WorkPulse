ALTER TABLE "budgets" ADD COLUMN "notified_period" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "overdue_notified_at" timestamp with time zone;