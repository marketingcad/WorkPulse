# Load tests

This folder is for engineers checking that Tallywork meets its performance targets ([docs/ops/slo.md](../docs/ops/slo.md)) before a release. Run these tests against **staging**, never production. Provisioning creates real accounts.

| Script | Simulates | Pass criteria |
|---|---|---|
| `k6/agents.js` | Desktop agents: one sync batch every 30 s and a heartbeat every 60 s each | ingest p95 < 500 ms, heartbeat p95 < 300 ms, < 1% errors |
| `k6/reads.js` | Managers opening dashboards, live view, time entries, attendance and a 30-day report | read p95 < 300 ms, report p95 < 1.5 s, < 1% errors |

## Steps

1. Provision agents on staging. This takes about 10 minutes for 10,000 agents at `CONCURRENCY=20`:

   ```bash
   BASE_URL=https://staging.example.com AGENTS=10000 CONCURRENCY=20 pnpm dlx tsx load/provision.ts
   ```

   This writes `load/tokens.json`. The file contains credentials and is gitignored.

2. Run the agents, at the roadmap target of 10,000 concurrent agents. Use a k6 Cloud or distributed run for this many VUs:

   ```bash
   k6 run -e AGENTS=10000 -e DURATION=30m load/k6/agents.js
   ```

3. While it runs, add read traffic:

   ```bash
   k6 run -e VUS=50 -e DURATION=30m load/k6/reads.js
   ```

4. Watch `/api/v1/ops/metrics`. `outbox_oldest_pending_seconds` must stay under 120, and no alerts should fire.

k6 exits non-zero when a threshold is missed.

## In CI

`packages/api/test/ops.test.ts` runs a small version on every push, as its own CI step (`LOAD_SMOKE=1`): 20 agents and 120 batches against the in-memory database, requiring p95 under 500 ms. It catches large regressions early. It does not replace the staging run above.

The provisioning script and the agent batch format were checked against a local API. The k6 scripts themselves have not been run here, because k6 isn't installed in this environment.
