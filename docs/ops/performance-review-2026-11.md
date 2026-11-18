# Performance review, November 2026 (Phase 14)

What was measured, what was found, what was fixed and what was left, for the screens people open most. Run it again with the commands below after changing a hot read.

## How it is measured

| What | Command | Where |
|---|---|---|
| Query budgets | `pnpm --filter @tallywork/api exec vitest run test/perf-budgets.test.ts` (part of the normal suite) | `packages/api/test/perf-budgets.test.ts` |
| Index review | `pnpm perf:index-review` (`SCALE=…` to change the size; `REVIEW_REPORT=<file>` keeps the report) | `packages/api/scripts/perf-index-review.ts` |
| Index usage | `pnpm --filter @tallywork/db exec vitest run test/hot-read-indexes.test.ts` | `packages/db/test/hot-read-indexes.test.ts` |
| Page speed (LCP) | `pnpm test:e2e tests/web/page-speed.spec.ts` | `e2e/tests/web/page-speed.spec.ts` |

- **Data.** `test/support/big-org.ts` builds an organization with bulk SQL: `20 × scale` members in `scale` teams, `4 × scale` projects with 10 tasks each, and 60 days of history per member (one session, time entry and rollup row per day, six 10-minute activity windows with a screenshot each, weekly timesheets), plus today's shifts and presence. At scale 10 that is 200 members, 12,000 sessions and time entries, and 72,000 activity windows and screenshots.
- **Reads.** `test/support/hot-reads.ts` lists 23 of them: dashboard widgets (the k6 keys), live tracking, time entries, attendance, the time & activity report, a member's timesheet, approvals, members, projects, clients, Summary, sessions, a day of activity, screenshots, the client portal summary and insights, AI Insights, and the main screens again as a team manager.
- **Query budgets** count the SQL statements per request (Server-Timing) at scale 1 and scale 5. A count that differs between the two is a query per row (N+1); a count above the budget fails too. Counts are deterministic; PGlite timings are not, so time is not asserted.
- **Index review** runs every hot read at scale 10 with a **second organization of the same size** in the same tables, as in production. It captures each `SELECT`, runs `EXPLAIN` as the app role inside the tenant context (row-level security included), and lists every sequential scan of a table over 10,000 rows.

## What was found and fixed

### One N+1: AI Insights overview

| | scale 1 | scale 5 |
|---|---|---|
| Before | 55 queries | 87 queries |
| After | 48 | 48 |

`projectInputs` (`services/ai-insights/gather.ts`) read each project's milestones separately: two queries per project. `listMilestonesByProject` (`services/performance.ts`) reads them in one query, with the same rows and order. Every other hot read already made the same number of queries at both sizes, including the team manager's views.

### Six full-table reads, from one pattern

Before the fixes, the review found 6 sequential scans on large tables (one organization in the database). All came from queries that **left the tenant filter to row-level security**. The RLS predicate is `bypass = 'on' OR organization_id = …`, and an `OR` like that can't be used with an index. So those queries could not use any index that starts with `organization_id`, and in production they read **every customer's rows**.

| Screen | Table | Fix |
|---|---|---|
| Projects list, AI Insights | `rollup_worker_day` (hours per project) | explicit organization filter + index `rollup_worker_day_org_project_idx (organization_id, project_id)` |
| Task lists, portal summary, AI Insights | `time_entries` (time per task) | explicit organization filter + index `time_entries_org_task_idx (organization_id, task_id)` |
| Sessions | `tracking_sessions` (list and count) | explicit organization filter; the overlap test `coalesce(ended_at, now()) >= from` cannot use an index, so the condition it implies, `ended_at >= from OR ended_at IS NULL`, is stated too; index `tracking_sessions_org_ended_idx (organization_id, ended_at)` |
| Screenshots | `activity_windows` (join for activity % and project) | explicit organization filter on both tables, and the join bounded to the period (a window starts at most 10 minutes before its screenshot). The join uses the primary key; no index needed |

The indexes are in migration `0036_hot_read_indexes.sql`. Every change keeps results identical: the added conditions are either guaranteed by RLS or implied by an existing condition. The full API suite passed unchanged (1,197 tests).

**After:** `pnpm perf:index-review` reports *no sequential scans on large tables* across 148 distinct statements, with two 200-member organizations sharing the tables.

### Query budgets (statements per request, the same at scale 1 and 5)

| Read | Queries | Read | Queries |
|---|---|---|---|
| dashboard widgets | 22 | manager: dashboard widgets | 21 |
| live tracking | 8 | manager: live tracking | 8 |
| time entries, 7 days | 6 | manager: time entries | 6 |
| attendance today | 12 | manager: attendance today | 11 |
| time & activity report, 30 days | 5 | manager: timesheet approvals | 5 |
| a member's timesheet | 10 | manager: AI Insights overview | 40 |
| timesheet approvals | 5 | AI Insights overview | 48 |
| members | 7 | Summary, 7 days | 13 |
| projects | 9 | sessions, 7 days | 9 |
| clients | 5 | a member's activity, one day | 11 |
| portal summary, 30 days | 20 | screenshots, one day | 6 |
| portal insights | 16 | | |

### Page speed (Largest Contentful Paint, production build)

Measured by `page-speed.spec.ts` against the E2E server (`next build` + `next start`, local, no network latency), three loads each:

| Page | Loads (ms) | Budget |
|---|---|---|
| Overview dashboard | 368, 244, 236 | median < 2,500 |
| Reports | 312, 284, 284 | median < 2,500 |
| Timesheets | 248, 228, 224 | median < 2,500 |

Well under the roadmap budget. Locally this guards against front-end regressions (a heavy bundle, render-blocking work); it does not predict times over a real network.

## What was left, and why

- **AI Insights still makes 48 queries.** It runs four sections, each reusing the screens' own services. It is cached per person and period, so this is the first view only. Merging sections would duplicate those services; left as is.
- **Other queries that rely on RLS alone.** The review covers the hot reads. Other services may still leave the tenant filter to RLS; that is correct (RLS enforces it) but can be slow on large tables. The fix is the same pattern: add `eq(table.organizationId, x.org.id)`. Add a read to `hot-reads.ts` to bring it under review.
- **`CREATE INDEX` without `CONCURRENTLY`.** Migrations run in a transaction, so the three indexes hold writes to their tables while they build. That takes seconds at today's sizes. A much larger database would need them created concurrently, by hand, before deploying.
- **Wall-clock time** is not measured here: PGlite in one process is not production Postgres over a network. The k6 load scripts in `load/` (owner-run, against staging) and the 10,000-agent test remain with the owner, as planned.
