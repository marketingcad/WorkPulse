-- When a project got its current client (null: from the start). Re-runnable.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "client_since" timestamp with time zone;
