-- Approved hours with no pay rate, per pay stub line (BUG-32). Additive and re-runnable.
ALTER TABLE "payroll_run_lines" ADD COLUMN IF NOT EXISTS "unpriced_seconds" integer DEFAULT 0 NOT NULL;
