ALTER TABLE "mfa_factors" ADD COLUMN "last_used_step" integer;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "mfa_pending" boolean DEFAULT false NOT NULL;