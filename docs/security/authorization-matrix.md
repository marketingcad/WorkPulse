# Authorization matrix

<!-- Generated from packages/domain/src/permissions.ts by `pnpm --filter @tallywork/domain gen:matrix`. Do not edit by hand. -->

Scopes: `own` = the member themselves, `assigned` = projects they are assigned to, `team` = members of teams they manage, `org` = the whole organization. `—` = not granted.
Custom roles can grant any subset, but never more than the admin who creates them holds.

## Built-in roles

| Permission | SYSTEM_ADMIN | TEAM_MANAGER | WORKER | AGENT |
|---|---|---|---|---|
| `org:read` | org | org | org | — |
| `org:update` | org | — | — | — |
| `roles:manage` | org | — | — | — |
| `members:read` | org | team | own | — |
| `members:manage` | org | — | — | — |
| `members:read_pay_rate` | org | — | — | — |
| `teams:read` | org | team | own | — |
| `teams:manage` | org | — | — | — |
| `clients:read` | org | assigned | assigned | — |
| `clients:manage` | org | — | — | — |
| `projects:read` | org | assigned | assigned | assigned |
| `projects:manage` | org | — | — | — |
| `tasks:read` | org | assigned | assigned | assigned |
| `tasks:create` | org | assigned | — | — |
| `tasks:manage` | org | assigned | — | — |
| `policies:read` | org | team | own | own |
| `policies:manage` | org | — | — | — |
| `devices:read` | org | team | own | — |
| `devices:manage` | org | — | own | — |
| `tracking:track` | own | own | own | own |
| `tracking:read` | org | team | own | — |
| `tracking:force_stop` | org | team | — | — |
| `activity:read` | org | team | own | — |
| `screenshots:read` | org | team | own | — |
| `screenshots:delete` | org | — | own | — |
| `apps:read` | org | team | own | — |
| `time:read` | org | team | own | — |
| `time:edit` | org | team | own | — |
| `manual_time:request` | own | own | own | — |
| `manual_time:approve` | org | team | — | — |
| `timesheets:read` | org | team | own | — |
| `timesheets:submit` | own | own | own | — |
| `timesheets:approve` | org | team | — | — |
| `attendance:read` | org | team | own | — |
| `schedules:read` | org | team | own | — |
| `schedules:manage` | org | team | — | — |
| `time_off:read` | org | team | own | — |
| `time_off:request` | own | own | own | — |
| `time_off:approve` | org | team | — | — |
| `time_off:manage` | org | — | — | — |
| `rates:read` | org | — | — | — |
| `rates:manage` | org | — | — | — |
| `billing:read` | org | — | — | — |
| `budgets:read` | org | assigned | — | — |
| `budgets:manage` | org | — | — | — |
| `expenses:read` | org | team | own | — |
| `expenses:create` | own | own | own | — |
| `expenses:approve` | org | team | — | — |
| `invoices:read` | org | — | — | — |
| `invoices:manage` | org | — | — | — |
| `payments:read` | org | — | — | — |
| `payments:manage` | org | — | — | — |
| `reports:read` | org | team | own | — |
| `reports:finance` | org | — | — | — |
| `api_keys:manage` | org | — | — | — |
| `webhooks:manage` | org | — | — | — |
| `audit:read` | org | — | — | — |
| `settings:security` | org | — | — | — |
| `retention:manage` | org | — | — | — |
| `agent:ingest` | — | — | — | own |

## API key scopes

A key acts as its creator, limited to the permissions below (and to the endpoints listed in docs/api/README.md).

| Scope | Permission |
|---|---|
| `read:workers` | `members:read` |
| `read:teams` | `teams:read` |
| `read:clients` | `clients:read` |
| `read:projects` | `projects:read` |
| `read:tasks` | `tasks:read` |
| `read:timesheets` | `timesheets:read` |
| `read:time` | `time:read` |
| `read:activity` | `activity:read` |
| `read:reports` | `reports:read` |
| `read:billing` | `billing:read` |
| `read:invoices` | `invoices:read` |
| `write:projects` | `projects:manage` |
| `write:tasks` | `tasks:manage` |
| `write:clients` | `clients:manage` |
