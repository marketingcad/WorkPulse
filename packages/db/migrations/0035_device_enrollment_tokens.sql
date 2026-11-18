-- Enrollment tokens for managed desktop installs (stored as a SHA-256 hash), and the token a device
-- joined with. Additive and re-runnable.
CREATE TABLE IF NOT EXISTS "device_enrollment_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_enrollment_tokens_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "device_enrollment_tokens_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "enrollment_token_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "device_enrollment_tokens" ADD CONSTRAINT "device_enrollment_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_enrollment_tokens_organization_id_created_at_index" ON "device_enrollment_tokens" USING btree ("organization_id","created_at");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "devices" ADD CONSTRAINT "devices_organization_id_enrollment_token_id_device_enrollment_tokens_organization_id_id_fk" FOREIGN KEY ("organization_id","enrollment_token_id") REFERENCES "public"."device_enrollment_tokens"("organization_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
