-- Archiving a team now lets go of its members and its projects (services/work.ts, QA BUG-38). Teams
-- archived before that kept their project links: they still showed on those projects, a project could
-- not be saved with them, and anyone put back on such a team regained its projects. Re-runnable.
DELETE FROM "project_teams" pt USING "teams" t WHERE pt."team_id" = t."id" AND t."archived_at" IS NOT NULL;
--> statement-breakpoint
DELETE FROM "team_members" tm USING "teams" t WHERE tm."team_id" = t."id" AND t."archived_at" IS NOT NULL;
