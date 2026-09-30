ALTER TABLE "invitations" ADD COLUMN "team_role" text DEFAULT 'MEMBER' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "project_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;