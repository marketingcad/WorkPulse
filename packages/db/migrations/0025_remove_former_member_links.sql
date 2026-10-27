-- Removing a member deletes their project and team links (services/org.ts). Members removed before
-- that rule kept them, and a project with such a link could not save its access editor. Re-runnable.
DELETE FROM "project_members" pm USING "memberships" m WHERE pm."membership_id" = m."id" AND m."status" = 'REMOVED';
--> statement-breakpoint
DELETE FROM "team_members" tm USING "memberships" m WHERE tm."membership_id" = m."id" AND m."status" = 'REMOVED';
