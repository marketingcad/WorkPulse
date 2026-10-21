# Screenshot retention & cleanup

Deletes screenshots older than an organization's retention period, together with their image and
thumbnail in object storage, on a schedule the organization sets. Admin page: **Settings ›
Screenshot retention** (`/o/:orgId/settings/screenshot-retention`).

## How it works

| Part | Where |
|---|---|
| Rules (cutoff, boundary, schedule, DST, retry delay) | `packages/domain/src/screenshot-retention.ts` |
| Settings, preview, approval, runs, background engine | `packages/api/src/services/screenshot-cleanup.ts` |
| API | `packages/api/src/routes/insight-platform.ts` (`/orgs/:orgId/screenshot-cleanup…`) |
| Tables | `screenshot_cleanup_settings`, `screenshot_cleanup_runs`; `screenshots.purge_attempts / purge_next_at / purge_error` (migration `0023_screenshot_cleanup.sql`) |
| Scheduler | the existing minute tick: `runTick` → `runScreenshotCleanup` (`packages/api/src/jobs/index.ts`) |

- **Defaults** (an organization with no settings row): enabled, 30 days, daily at 02:00 in the
  organization's time zone, retries on, **not approved**. Nothing is deleted until an
  administrator previews and approves.
- **Cutoff:** fixed when a run starts: `run start − retention days × 24 h`. A screenshot is deleted
  only if `captured_at < cutoff`; one captured exactly at the cutoff is kept.
- **Approval:** the first deletion needs an approved preview (at most 24 h old) for the current
  policy version. Making the retention period shorter bumps the version and withdraws the approval.
  A longer period, or a change of time, day, frequency or time zone, keeps it. The backend enforces
  this on every run, not just the UI.
- **Permissions:** reading needs `retention:manage` or `settings:security`. Changing, previewing,
  approving and running need `retention:manage` (System Admin only, by default).
- **Limits:** per organization, 20 previews and 10 manual runs an hour. They are counted inside the
  request's transaction, because the generic `rateLimit` middleware cannot be used on org routes.

### A run

1. The minute tick finds enabled settings whose `next_run_at` has passed. If the policy is approved,
   it inserts a `RUNNING` run with its fixed cutoff, then moves `next_run_at` on. A partial unique
   index allows one running run per organization. A missed run (for example after downtime) runs
   once, with no catch-up runs.
2. Each batch of 200 runs in its own tenant transaction:
   - it locks the run row (`FOR UPDATE SKIP LOCKED`), so only one worker processes a run;
   - it locks the eligible screenshots (`SKIP LOCKED`), selected through the
     `(organization_id, captured_at)` index;
   - it deletes their objects from storage, and only then deletes the rows.
3. Storage keys come only from each screenshot's own row. Keys outside `org/<orgId>/` are never
   deleted. Every key embeds the screenshot id, so objects are never shared between rows.
4. **Storage failure:** the row is kept and `purge_attempts` is incremented, with a retry wait of
   2, 4, 8 … minutes. After 5 failed attempts (1 if retries are off) the row is left for an
   administrator, shown as "left out" in previews. Deleting an object that is already gone counts
   as success, so retries are safe.
5. **Crash:** a batch that fails rolls back. The run stays `RUNNING` and the next tick continues it,
   because which screenshots remain to delete is worked out again each batch. A run with no
   progress for 30 minutes notifies administrators; after 2 hours it is closed as `FAILED`, and the
   next run picks up what is left.
6. If the policy is shortened, or a scheduled run's cleanup is turned off, while a run is going, the
   run stops as `CANCELLED` before its next batch.
7. Each tick spends at most 25 s on cleanup. A large backlog continues on the following ticks.

**Alerts** (in-app notifications to holders of `retention:manage`, sent once per incident until a
run succeeds):

- two failed or partial runs in a row;
- screenshots that failed every retry;
- a stalled run;
- no successful run for 2 × the interval plus a day.

**Storage figures** are sums of the `bytes` recorded at upload. They are estimates: thumbnails are
not measured, and providers may store more. No storage-capacity percentage is shown, because the
storage adapters do not report capacity.

## Deployment

- No new environment variables. It uses the existing `CRON_SECRET`, the Vercel cron in
  `apps/web/vercel.json` (`/api/v1/cron/tick` every minute), and the configured storage
  (`SUPABASE_*` or `BLOB_READ_WRITE_TOKEN`).
- The migration runs in `vercel-build` (`pnpm --filter @tallywork/db migrate`). It is idempotent
  (`IF NOT EXISTS`). It carries each organization's existing `SCREENSHOTS` retention period into
  the new table ("kept forever" becomes cleanup turned off), with no approval.
- Self-hosted or without cron: the request-driven `maybeTick` runs the same tick once per minute
  under a database lease.

### First rollout checklist

1. Deploy. Nothing is deleted yet: no organization is approved.
2. As a System Admin, open Settings › Screenshot retention and select **Preview cleanup**. Check the
   counts and dates against what you expect.
3. Approve. Run once with **Run cleanup now**, or wait for 02:00, and check **Cleanup history**.
4. Watch the next scheduled runs and the audit log (`screenshot_cleanup.*`).

## Recovery and rollback

- **Stop deletions now:** turn off "Delete expired screenshots automatically" (scheduled runs stop
  and a running scheduled run stops at its next batch), or shorten and re-save to withdraw the
  approval. Deleted screenshots cannot be restored; there is no soft delete.
- **Screenshots stuck after retries:** fix storage access, then run
  `update screenshots set purge_attempts = 0, purge_next_at = null where organization_id = '<org>' and purge_attempts >= 5;`
  The next run retries them.
- **A run stuck in `RUNNING`:** it is closed automatically after 2 hours without progress. To close
  it sooner:
  `update screenshot_cleanup_runs set status = 'FAILED', finished_at = now(), error = 'Closed by operator' where id = '<run>' and status = 'RUNNING';`
- **Roll back the code:** the previous release ignores the new tables and columns. Note that it
  also brings back the old daily screenshot purge for organizations with a `SCREENSHOTS` row in
  `retention_policies`. Drizzle migrations are forward-only. To remove the schema after rolling
  back the code:

  ```sql
  drop table if exists screenshot_cleanup_runs;
  drop table if exists screenshot_cleanup_settings;
  alter table screenshots drop column if exists purge_attempts, drop column if exists purge_next_at, drop column if exists purge_error;
  delete from drizzle.__drizzle_migrations where hash = '<hash of 0023>';
  ```

## Known limits

- No legal-hold concept exists in WorkPulse. Every expired screenshot in the organization is
  eligible.
- Freed space is estimated from recorded image sizes. Thumbnails are not measured, and providers
  may report different figures.
- Each organization has its own policy. There is no platform-wide policy above it.
