CREATE TABLE "break_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"max_minutes" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shift_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"shift_start" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_segments" ADD COLUMN "break_type_id" uuid;--> statement-breakpoint
ALTER TABLE "time_segments" ADD COLUMN "alerted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "break_types_organization_id_index" ON "break_types" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_alerts_once_uq" ON "shift_alerts" USING btree ("membership_id","shift_start","kind");