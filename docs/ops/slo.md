# Service levels and monitoring

This page is for the people who run Tallywork in production. It lists the targets, how each one is measured, and which alert fires when a target is at risk. The response to each alert is in [runbooks.md](runbooks.md).

## Targets

| Service level | Target | Measured by |
|---|---|---|
| Availability of the web app and API | 99.9% per month | Uptime check on `GET /api/v1/health/ready`, every minute, from outside Vercel |
| API read latency | p95 under 300 ms | Vercel function metrics and the request log (`ms` on each line), and the `load/k6/reads.js` threshold |
| Desktop ingest latency | p95 under 500 ms | The `http_req_duration{name:ingest}` threshold in `load/k6/agents.js`, and the request log for `route=/api/v1/agent/ingest/batch` |
| Event delivery (notifications, webhooks, rollups) | 99% within 2 minutes | `outbox_oldest_pending_seconds` from `/ops/metrics` |
| Webhook delivery | first attempt within 2 minutes | `webhooks_overdue_seconds` |
| Desktop app crash-free sessions | 99.5% | Crash reports sent to `TALLYWORK_CRASH_URL`, divided by active devices |
| Recovery point / recovery time | RPO 5 minutes / RTO 4 hours | Supabase point-in-time recovery, proven by the quarterly restore drill |

## Health endpoints

| Endpoint | Auth | Use |
|---|---|---|
| `GET /api/v1/health` | none | Liveness. The function is up. |
| `GET /api/v1/health/ready` | none | Readiness. Returns `503` when the database doesn't answer within 2 s. Point the uptime check and status page here. |
| `GET /api/v1/ops/metrics` | `Authorization: Bearer $CRON_SECRET` | Operational gauges and firing alerts. Counts only, never tenant data. Poll every minute from the monitoring system. |

`/ops/metrics` returns:

```json
{ "time": "…", "metrics": { "outbox_pending": 0, "outbox_oldest_pending_seconds": 0, "outbox_parked": 0, "seconds_since_last_dispatch": 12,
  "webhooks_pending": 0, "webhooks_overdue_seconds": 0, "webhooks_dead_24h": 0, "report_runs_queued": 0, "report_runs_oldest_queued_seconds": 0,
  "report_runs_failed_24h": 0, "tracking_sessions_live": 431, "agents_not_synced_1h": 3, "integrations_in_error": 0, "rollup_drift_orgs_24h": 0 },
  "alerts": [] }
```

## Alerts

The server evaluates the rules (`packages/api/src/services/ops.ts`) and returns firing alerts in `alerts[]`. The monitoring system should page or open a ticket for each alert, using the severity below.

| Alert | Severity | Fires when | Runbook |
|---|---|---|---|
| `outbox_backlog` | page | The oldest undelivered event is more than 5 minutes old | [Event backlog](runbooks.md#event-backlog) |
| `outbox_parked` | ticket | An event failed 10 times and was set aside | [Parked events](runbooks.md#parked-events) |
| `webhooks_overdue` | ticket | Deliveries are more than 10 minutes behind schedule | [Webhooks](runbooks.md#webhooks-behind-or-failing) |
| `webhooks_dead` | ticket | More than 20 deliveries gave up in 24 h | [Webhooks](runbooks.md#webhooks-behind-or-failing) |
| `exports_stuck` | ticket | An export has been queued for more than 15 minutes | [Exports](runbooks.md#exports-stuck-or-failing) |
| `exports_failing` | ticket | More than 10 exports failed in 24 h | [Exports](runbooks.md#exports-stuck-or-failing) |
| `rollup_drift` | ticket | The nightly check had to rebuild rollups | [Rollup drift](runbooks.md#rollup-drift) |

Also alert on:

- **Readiness:** `health/ready` failing twice in a row. Page.
- **Error rate:** the function error rate above 1% for 5 minutes, from Vercel.
- **Cron:** `seconds_since_last_dispatch` above 600 while `outbox_pending` is above 0. Cron has stopped.

## Request log

Each API request writes one JSON line to stdout. Vercel log drains carry it to the log store.

```json
{"level":"info","msg":"request","request_id":"…","method":"POST","route":"/api/v1/agent/ingest/batch","status":200,"ms":84}
```

`route` is the route pattern: it has no IDs and no query strings, and the log never contains request bodies. Errors are logged separately with the same `request_id`, and users see that ID in error responses.
