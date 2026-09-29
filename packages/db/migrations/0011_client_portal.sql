CREATE TABLE "client_portal_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"user_id" uuid,
	"status" text DEFAULT 'INVITED' NOT NULL,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"invited_by" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_portal_settings" (
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sections" jsonb DEFAULT '{"hours":true,"tasks":true,"activity":false,"screenshots":false}'::jsonb NOT NULL,
	"project_ids" jsonb,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_portal_settings_organization_id_client_id_pk" PRIMARY KEY("organization_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_access" ADD CONSTRAINT "client_portal_access_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_settings" ADD CONSTRAINT "client_portal_settings_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_portal_access_email_uq" ON "client_portal_access" USING btree ("organization_id","client_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "client_portal_access_token_uq" ON "client_portal_access" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE INDEX "client_portal_access_user_id_index" ON "client_portal_access" USING btree ("user_id");