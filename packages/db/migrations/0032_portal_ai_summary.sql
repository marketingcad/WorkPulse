-- Client portal AI summary (packages/db/src/schema/portal.ts): the stored daily summary per client, and
-- the new `ai_summary` dashboard section (off by default). Additive and re-runnable.
CREATE TABLE IF NOT EXISTS "portal_ai_summaries" (
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"day" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_ai_summaries_organization_id_client_id_day_pk" PRIMARY KEY("organization_id","client_id","day")
);
--> statement-breakpoint
ALTER TABLE "client_portal_settings" ALTER COLUMN "sections" SET DEFAULT '{"hours":true,"tasks":true,"activity":false,"screenshots":false,"ai_summary":false}'::jsonb;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "portal_ai_summaries" ADD CONSTRAINT "portal_ai_summaries_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
