# Runbooks

This page is for whoever is on call for Tallywork. Each section covers one alert or one planned operation: what it means, how to check, and what to do. Targets and alert rules are in [slo.md](slo.md).

The platform is **Vercel** (web app, API and cron) plus **Supabase** (Postgres and file storage). The sections below use:

- **Metrics:** `curl -s -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/v1/ops/metrics`
- **Database:** the Supabase SQL editor, or `psql "$DATABASE_URL"`.
- **Cron:** runs every minute (`/api/v1/cron/tick`) and daily (`/api/v1/cron/daily`), both from `vercel.json`. Either can be run by hand with `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/v1/cron/tick`.

---

## Event backlog

**Alert:** `outbox_backlog`, when the oldest undelivered event is more than 5 minutes old.

**What people notice:** notifications, webhooks, dashboard totals and reports lag behind. Tracked time itself is not affected, because events are written in the same transaction as the change and are never lost.

1. Check `seconds_since_last_dispatch`. If it is large, cron has stopped:
   - check **Vercel → Cron Jobs** for failures;
   - run the tick by hand (see the top of this page).
2. If the tick runs but the backlog grows, check `health/ready` and the Supabase status page. A struggling database slows everything down.
3. Drain the backlog by running the tick a few times. Each run processes up to 200 events, and they are delivered in order.
4. If one organization is producing a flood of events, find it with:
   `select organization_id, count(*) from outbox_events where processed_at is null group by 1 order by 2 desc limit 5;`

## Parked events

**Alert:** `outbox_parked`, when an event failed 10 times and was set aside so it wouldn't block the others.

1. Look at the parked events:
   `select id, event_type, attempts, last_error, created_at from outbox_events where processed_at is null and attempts >= 10;`
2. `last_error` usually points to a bug or bad data. Fix the cause and deploy.
3. To retry an event: `update outbox_events set attempts = 0 where id = '<id>';`
4. If it can never succeed, mark it done: `update outbox_events set processed_at = now() where id = '<id>';`
   Write down what was dropped. Rollups repair themselves overnight.

## Webhooks behind or failing

**Alerts:** `webhooks_overdue`, `webhooks_dead`.

- **Overdue** means deliveries are waiting on the tick. Handle it like an [event backlog](#event-backlog).
- **Dead** means a customer's endpoint keeps failing. Customers see every attempt under **Developer → Webhooks → Deliveries**, and endpoints are disabled automatically after 50 failures in a row.
  - Contact the organization if it's a paying customer.
  - After they fix their endpoint, they can **Replay** past deliveries themselves.
- Tallywork never sends to private addresses and never follows redirects. An endpoint that recently moved behind a redirect will fail until its URL is updated.

## Exports stuck or failing

**Alerts:** `exports_stuck`, `exports_failing`.

1. `select id, report_key, format, status, error, created_at from report_runs where status in ('QUEUED','RUNNING','FAILED') order by created_at desc limit 20;`
2. A run stuck in `RUNNING` means the function timed out mid-export. Very large exports can hit the 300 s limit. Set it back to `QUEUED` to retry, or advise the customer to use a shorter date range.
3. `FAILED` runs record the reason in `error`. A permission error means the requester lost access, which is expected.

## Rollup drift

**Alert:** `rollup_drift`. The nightly check found dashboard or report totals that no longer matched the time entries, and rebuilt them.

- A one-off is harmless. Details are in the audit log (`action = 'rollups.reconciled'`).
- If it happens every night, something writes time entries without emitting `time.changed`. Find what changed, from the `metadata` counts and recent deploys.

## Database outage

**What people see:** `health/ready` returns 503, and the web app shows errors.

- **Desktop apps keep tracking.** They save events on the device, encrypted, and replay them when the API is back. Nothing is lost.
- Check the Supabase status and the project's dashboard (connections, CPU, disk). Connection-limit errors mean the Session pooler is saturated: lower the pool size or upgrade the plan.
- When the database is back, run the tick by hand to drain the backlog quickly, then watch `outbox_pending` fall to 0.

## Deploy rollback

- **Web app and API:** in **Vercel → Deployments**, choose the last good deployment and select **Instant Rollback**. No build is needed.
- **Migrations:** migrations only add things (tables, columns, indexes), so the previous deployment runs fine on the newer schema. Never roll back a migration by hand. Fix it forward.
- **Large index builds:** `CREATE INDEX` blocks writes to that table while it runs. On tables with millions of rows, create the index by hand first with `CREATE INDEX CONCURRENTLY` (same name as in the migration), then deploy. The migration's `IF NOT EXISTS` makes it a no-op.

## Restore drill (quarterly) and real restore

Supabase keeps point-in-time recovery (PITR) for the project's retention window. The drill proves the RTO and that restored data is usable. Record the timings each time.

1. In **Supabase → Database → Backups → Point in time**, restore to a timestamp **into a new project**. Never restore over production.
2. On the new project, run `pnpm db:migrate`, which is safe to repeat, so the roles and functions match the current code.
3. Point a preview deployment at it: set `DATABASE_URL` to the new project's Session pooler, then `vercel deploy`. Then check:
   - sign-in works;
   - yesterday's timesheets and reports look right;
   - `/ops/metrics` answers.
4. Compare row counts for `time_entries`, `timesheets`, `invoices` and `audit_logs` against production at the same timestamp.
5. **Real restore:** do steps 1 to 4, then switch production's `DATABASE_URL` to the restored project and redeploy. Desktop apps replay anything they recorded after the restore point.
6. File storage (screenshots, receipts, exports) is not part of the database restore. It stays in the Supabase Storage bucket, and restored rows point at the same object keys.

## Rotating secrets

- **`CRON_SECRET`:** set the new value in Vercel and redeploy. Update the monitoring system's metrics check.
- **`APP_SECRET`:** this signs sessions, links and device tokens, and encrypts webhook, integration and TOTP secrets. Rotating it:
  - signs everyone out;
  - makes stored encrypted secrets unreadable, so webhook endpoints need their secret rotated, integrations need reconnecting, and people need to set up 2FA again.

  Rotate it only after a suspected leak, and announce it.
- **`SUPABASE_SERVICE_ROLE_KEY`:** create a new secret key in Supabase, set it in Vercel, redeploy, then revoke the old key.

## Desktop release (staged)

1. Build and sign with `pnpm --filter @tallywork/desktop dist`, with the signing variables set in CI.
2. Publish to the update server under the **beta** channel first. Machines with `TALLYWORK_UPDATE_CHANNEL=beta` get it within 6 hours.
3. After 48 h with no crash increase (the crash-free SLO), publish to **latest** with `stagingPercentage: 10` in `latest.yml`. Raise it to 50, then 100, a day apart.
4. To stop a rollout, set `stagingPercentage: 0` or republish the previous version. Updates never interrupt a running timer; they install when the app quits.
