-- Performance Center: scoring rules, milestones, goals, achievements, reviews, score snapshots and client
-- appreciation (packages/db/src/schema/performance.ts). Additive and re-runnable.
CREATE TABLE IF NOT EXISTS "achievement_awards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"membership_id" uuid,
	"team_id" uuid,
	"recipient_key" text NOT NULL,
	"tier" text DEFAULT 'NONE' NOT NULL,
	"period_key" text NOT NULL,
	"source" text NOT NULL,
	"awarded_by" uuid,
	"reason" text,
	"visibility" text DEFAULT 'PUBLIC' NOT NULL,
	"evidence" jsonb,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_awards_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "achievement_awards_recipient_ck" CHECK (("achievement_awards"."membership_id" is not null and "achievement_awards"."team_id" is null) or ("achievement_awards"."team_id" is not null and "achievement_awards"."membership_id" is null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "achievement_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"icon" text NOT NULL,
	"mode" text NOT NULL,
	"metric" text,
	"thresholds" jsonb,
	"recurrence" text NOT NULL,
	"default_visibility" text DEFAULT 'PUBLIC' NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "achievement_definitions_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "achievement_definitions_mode_ck" CHECK (("achievement_definitions"."mode" = 'AUTOMATIC' and "achievement_definitions"."metric" is not null and "achievement_definitions"."thresholds" is not null) or ("achievement_definitions"."mode" = 'MANUAL' and "achievement_definitions"."metric" is null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_appreciations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"portal_access_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"membership_id" uuid,
	"message" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_goal_progress" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"value" integer NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"actor_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text,
	"subject_type" text NOT NULL,
	"membership_id" uuid,
	"team_id" uuid,
	"project_id" uuid,
	"metric" text NOT NULL,
	"target_value" integer NOT NULL,
	"current_value" integer DEFAULT 0 NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_goals_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "performance_goals_subject_ck" CHECK (("performance_goals"."subject_type" = 'MEMBER' and "performance_goals"."membership_id" is not null and "performance_goals"."team_id" is null and "performance_goals"."project_id" is null)
       or ("performance_goals"."subject_type" = 'TEAM' and "performance_goals"."team_id" is not null and "performance_goals"."membership_id" is null and "performance_goals"."project_id" is null)
       or ("performance_goals"."subject_type" = 'PROJECT' and "performance_goals"."project_id" is not null and "performance_goals"."membership_id" is null and "performance_goals"."team_id" is null)
       or ("performance_goals"."subject_type" = 'ORG' and "performance_goals"."membership_id" is null and "performance_goals"."team_id" is null and "performance_goals"."project_id" is null)),
	CONSTRAINT "performance_goals_target_ck" CHECK ("performance_goals"."target_value" > 0 and "performance_goals"."end_date" >= "performance_goals"."start_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"reviewer_membership_id" uuid NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"quality_rating" integer,
	"summary" text,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"improvements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommendations" text,
	"private_note" text,
	"shared_with_member" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_reviews_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "performance_reviews_rating_ck" CHECK ("performance_reviews"."quality_rating" is null or "performance_reviews"."quality_rating" between 1 and 5),
	CONSTRAINT "performance_reviews_period_ck" CHECK ("performance_reviews"."period_end" >= "performance_reviews"."period_start")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"weights" jsonb NOT NULL,
	"min_eligible_days" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_rules_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "performance_rules_version_uq" UNIQUE("organization_id","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_score_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"period_type" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"rule_id" uuid NOT NULL,
	"rule_version" integer NOT NULL,
	"score" numeric(4, 1),
	"coverage" integer NOT NULL,
	"metrics" jsonb NOT NULL,
	"eligible" boolean NOT NULL,
	"rank_group" text,
	"final" boolean DEFAULT false NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"leaderboard_workers" boolean DEFAULT false NOT NULL,
	"leaderboard_managers" boolean DEFAULT true NOT NULL,
	"workers_see_own_score" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_settings_org_uq" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" text NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"client_visible" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_milestones_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "achievement_awards" ADD CONSTRAINT "achievement_awards_organization_id_definition_id_achievement_definitions_organization_id_id_fk" FOREIGN KEY ("organization_id","definition_id") REFERENCES "public"."achievement_definitions"("organization_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "achievement_awards" ADD CONSTRAINT "achievement_awards_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "achievement_awards" ADD CONSTRAINT "achievement_awards_organization_id_team_id_teams_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "achievement_definitions" ADD CONSTRAINT "achievement_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "client_appreciations" ADD CONSTRAINT "client_appreciations_organization_id_client_id_clients_organization_id_id_fk" FOREIGN KEY ("organization_id","client_id") REFERENCES "public"."clients"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "client_appreciations" ADD CONSTRAINT "client_appreciations_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "client_appreciations" ADD CONSTRAINT "client_appreciations_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "client_appreciations" ADD CONSTRAINT "client_appreciations_portal_access_id_client_portal_access_id_fk" FOREIGN KEY ("portal_access_id") REFERENCES "public"."client_portal_access"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "performance_goal_progress" ADD CONSTRAINT "performance_goal_progress_organization_id_goal_id_performance_goals_organization_id_id_fk" FOREIGN KEY ("organization_id","goal_id") REFERENCES "public"."performance_goals"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "performance_goals" ADD CONSTRAINT "performance_goals_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "performance_goals" ADD CONSTRAINT "performance_goals_organization_id_team_id_teams_organization_id_id_fk" FOREIGN KEY ("organization_id","team_id") REFERENCES "public"."teams"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "performance_goals" ADD CONSTRAINT "performance_goals_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_organization_id_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_organization_id_reviewer_membership_id_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","reviewer_membership_id") REFERENCES "public"."memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "performance_rules" ADD CONSTRAINT "performance_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "performance_score_snapshots" ADD CONSTRAINT "performance_score_snapshots_organization_id_rule_id_performance_rules_organization_id_id_fk" FOREIGN KEY ("organization_id","rule_id") REFERENCES "public"."performance_rules"("organization_id","id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "performance_settings" ADD CONSTRAINT "performance_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_organization_id_project_id_projects_organization_id_id_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "achievement_awards_once_uq" ON "achievement_awards" USING btree ("organization_id","definition_id","recipient_key","tier","period_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "achievement_awards_organization_id_membership_id_created_at_index" ON "achievement_awards" USING btree ("organization_id","membership_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "achievement_awards_organization_id_created_at_index" ON "achievement_awards" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "achievement_definitions_key_uq" ON "achievement_definitions" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_appreciations_organization_id_status_created_at_index" ON "client_appreciations" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "performance_goal_progress_source_uq" ON "performance_goal_progress" USING btree ("organization_id","goal_id","source_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_goal_progress_organization_id_goal_id_created_at_index" ON "performance_goal_progress" USING btree ("organization_id","goal_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_goals_organization_id_status_end_date_index" ON "performance_goals" USING btree ("organization_id","status","end_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_goals_organization_id_membership_id_index" ON "performance_goals" USING btree ("organization_id","membership_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_reviews_organization_id_membership_id_period_end_index" ON "performance_reviews" USING btree ("organization_id","membership_id","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "performance_score_snapshots_uq" ON "performance_score_snapshots" USING btree ("organization_id","subject_type","subject_id","period_type","period_start");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "performance_score_snapshots_organization_id_period_type_period_start_subject_type_index" ON "performance_score_snapshots" USING btree ("organization_id","period_type","period_start","subject_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_milestones_organization_id_project_id_due_date_index" ON "project_milestones" USING btree ("organization_id","project_id","due_date");
--> statement-breakpoint
-- Existing organizations: the built-in roles get the Performance Center permissions (new orgs get them
-- from ROLE_PRESETS). role_permissions has FORCE row-level security, so this runs with the bypass on.
SELECT set_config('app.bypass_rls', 'on', false);--> statement-breakpoint
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission", "scope")
SELECT r."organization_id", r."id", p.permission, 'org' FROM "roles" r CROSS JOIN (VALUES ('performance:read'), ('performance:manage'), ('goals:read'), ('goals:manage'), ('achievements:read'), ('achievements:manage'), ('achievements:award'), ('reviews:read'), ('reviews:manage')) AS p(permission)
WHERE r."key" = 'SYSTEM_ADMIN' AND r."builtin"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission", "scope")
SELECT r."organization_id", r."id", p.permission, 'team' FROM "roles" r CROSS JOIN (VALUES ('performance:read'), ('goals:read'), ('goals:manage'), ('achievements:read'), ('achievements:award'), ('reviews:read'), ('reviews:manage')) AS p(permission)
WHERE r."key" = 'TEAM_MANAGER' AND r."builtin"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("organization_id", "role_id", "permission", "scope")
SELECT r."organization_id", r."id", p.permission, 'own' FROM "roles" r CROSS JOIN (VALUES ('performance:read'), ('goals:read'), ('achievements:read')) AS p(permission)
WHERE r."key" = 'WORKER' AND r."builtin"
ON CONFLICT DO NOTHING;--> statement-breakpoint
SELECT set_config('app.bypass_rls', 'off', false);
