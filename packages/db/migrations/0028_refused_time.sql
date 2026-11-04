-- Time not added: refused offline records (packages/db/src/schema/tracking.ts, refusedTime). Re-runnable.
CREATE TABLE IF NOT EXISTS "refused_time" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" text NOT NULL,
	"project_id" uuid,
	"task_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"event_count" integer DEFAULT 1 NOT NULL,
	"manual_request_id" uuid,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "refused_time" ADD CONSTRAINT "refused_time_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "refused_time_session_uq" ON "refused_time" USING btree ("organization_id","membership_id","session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "refused_time_organization_id_started_at_index" ON "refused_time" USING btree ("organization_id","started_at");
