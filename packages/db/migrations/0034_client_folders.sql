-- Client folders: an optional way to organize projects by client (settings.clientFolders). A folder's
-- projects are its client's (projects.client_id); no project row changes. Additive and re-runnable.
CREATE TABLE IF NOT EXISTS "client_folders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_folders_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "client_folders_client_uq" UNIQUE("organization_id","client_id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "client_folders" ADD CONSTRAINT "client_folders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "client_folders" ADD CONSTRAINT "client_folders_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
