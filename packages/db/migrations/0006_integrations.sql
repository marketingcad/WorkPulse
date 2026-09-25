CREATE TABLE "external_refs" (
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_refs_connection_id_entity_type_external_id_pk" PRIMARY KEY("connection_id","entity_type","external_id")
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_enc" text,
	"sync_requested_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "external_refs_connection_id_entity_type_entity_id_index" ON "external_refs" USING btree ("connection_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "integration_connections_organization_id_index" ON "integration_connections" USING btree ("organization_id");