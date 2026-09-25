CREATE INDEX IF NOT EXISTS "activity_minutes_organization_id_minute_start_index" ON "activity_minutes" USING btree ("organization_id","minute_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_spans_organization_id_started_at_index" ON "app_spans" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingest_receipts_organization_id_received_at_index" ON "ingest_receipts" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "screenshots_organization_id_captured_at_index" ON "screenshots" USING btree ("organization_id","captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_organization_id_local_date_index" ON "time_entries" USING btree ("organization_id","local_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_segments_open_idx" ON "time_segments" USING btree ("membership_id") WHERE "time_segments"."ended_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tracking_sessions_live_idx" ON "tracking_sessions" USING btree ("state") WHERE "tracking_sessions"."state" <> 'STOPPED';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "url_spans_organization_id_started_at_index" ON "url_spans" USING btree ("organization_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_entries_timesheet_id_index" ON "billing_entries" USING btree ("timesheet_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_entries_organization_id_project_id_local_date_index" ON "billing_entries" USING btree ("organization_id","project_id","local_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_organization_id_actor_id_index" ON "audit_logs" USING btree ("organization_id","actor_id");