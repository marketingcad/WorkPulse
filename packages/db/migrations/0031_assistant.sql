-- WorkPulse AI assistant: conversations and messages (packages/db/src/schema/assistant.ts) and the
-- AI_CONVERSATIONS retention class. Additive and re-runnable.
CREATE TABLE IF NOT EXISTS "assistant_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"title" text NOT NULL,
	"stream_lock_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone,
	CONSTRAINT "assistant_conversations_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"nav_targets" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_messages_role_ck" CHECK ("assistant_messages"."role" in ('user', 'assistant'))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_organization_id_conversation_id_assistant_conversations_organization_id_id_fk" FOREIGN KEY ("organization_id","conversation_id") REFERENCES "public"."assistant_conversations"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_conversations_member_idx" ON "assistant_conversations" USING btree ("organization_id","membership_id","last_message_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assistant_messages_conversation_idx" ON "assistant_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
INSERT INTO "retention_policies" ("organization_id", "data_class", "keep_days") SELECT "id", 'AI_CONVERSATIONS', 90 FROM "organizations" ON CONFLICT DO NOTHING;
