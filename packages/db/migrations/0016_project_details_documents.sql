CREATE TABLE "project_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "short_name" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "start_date" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "end_date" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "estimate_seconds" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "estimate_unit" text DEFAULT 'HOURS' NOT NULL;--> statement-breakpoint
CREATE INDEX "project_documents_organization_id_project_id_index" ON "project_documents" USING btree ("organization_id","project_id");