-- Indexes from the Phase 14 index review (docs/ops/performance-review-2026-11.md). Each one replaced a
-- full-table read in a hot screen. Additive and re-runnable. Plain CREATE INDEX (migrations run in a
-- transaction): it holds writes to the table while it builds, which takes seconds at today's sizes.

-- Projects list and project page: all-time hours per project (services/work.ts listProjects).
CREATE INDEX IF NOT EXISTS "rollup_worker_day_org_project_idx" ON "rollup_worker_day" USING btree ("organization_id","project_id");--> statement-breakpoint
-- Time per task: task lists (services/work.ts), the client portal summary and AI insights.
CREATE INDEX IF NOT EXISTS "time_entries_org_task_idx" ON "time_entries" USING btree ("organization_id","task_id");--> statement-breakpoint
-- Sessions list: sessions that ended in the range or are still open (services/timer.ts, tracking.ts).
CREATE INDEX IF NOT EXISTS "tracking_sessions_org_ended_idx" ON "tracking_sessions" USING btree ("organization_id","ended_at");
