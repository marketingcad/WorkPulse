CREATE TABLE "eod_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid,
	"local_date" text NOT NULL,
	"body" text NOT NULL,
	"finished" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_breaks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"break_type_id" uuid NOT NULL,
	"start_time" text,
	"duration_minutes" integer,
	"position" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eod_reports" ADD CONSTRAINT "eod_reports_organization_id_session_id_tracking_sessions_organization_id_id_fk" FOREIGN KEY ("organization_id","session_id") REFERENCES "public"."tracking_sessions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eod_reports" ADD CONSTRAINT "eod_reports_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_breaks" ADD CONSTRAINT "project_breaks_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_breaks" ADD CONSTRAINT "project_breaks_break_type_id_break_types_id_fk" FOREIGN KEY ("break_type_id") REFERENCES "public"."break_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eod_reports_session_uq" ON "eod_reports" USING btree ("organization_id","session_id");--> statement-breakpoint
CREATE INDEX "eod_reports_organization_id_local_date_index" ON "eod_reports" USING btree ("organization_id","local_date");--> statement-breakpoint
CREATE INDEX "eod_reports_organization_id_membership_id_local_date_index" ON "eod_reports" USING btree ("organization_id","membership_id","local_date");--> statement-breakpoint
CREATE INDEX "project_breaks_organization_id_project_id_index" ON "project_breaks" USING btree ("organization_id","project_id");