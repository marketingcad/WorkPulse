# Performance Center: implementation status

Branch: `feat/performance-center`. Designs: the "Performance Center designs" canvas (https://claude.ai/artifact/Xirvm1HWmefQdoCzL8Yffy, 8 screens plus the sidebar).
Last updated: 5 November 2026.

**Status in one line:** the backend for every phase is built and tested (domain, database, API, jobs, client portal API, desktop own-data API). Not started: the web pages, the desktop screen, the project-page milestone panel, the portal Insights tab, and their E2E tests.

---

## 1. Rules the module follows (do not change)

- **What a score is made of.** A 0–100 score built from five outcomes:

  | Metric | Default weight |
  |---|---|
  | Goal completion | 30% |
  | Project delivery against due dates | 25% |
  | Approved-work consistency | 20% |
  | Quality, from manager reviews | 15% |
  | Attendance | 10% |

  Activity levels, keystrokes and screenshots are never inputs.
- **Missing data.** A metric with no data is `null`, never 0. It is left out and the other weights are re-normalized. When less than 50% of the weight is measured (`MIN_SCORE_COVERAGE`), there is no score.
- **Weights.** Organization-configurable. They must be whole numbers adding up to 100. Every change creates a new **rules version** (`performance_rules` rows are never edited).
- **Snapshots.** Each snapshot stores the rule version and the raw inputs it used.
  - A period stays open for `SCORE_SETTLE_DAYS` (14) after it ends, so timesheets approved and reviews written after it ends still count. The daily job recalculates every period that has not settled, not only the previous one.
  - After that, the snapshot is **final** and is never recalculated, even after the rules change.
  - Reading a settled period never computes it: a period with no snapshots shows no scores. An admin cannot recalculate a settled period (422 `period_closed`).
  - Snapshots are saved in one insert-or-update statement that never overwrites a final row, so concurrent first reads cannot collide.
- **Fair ranking.**
  - People are ranked only within their **role family**: their job title (`worker_profiles.title`), otherwise their role name.
  - People with fewer than `min_eligible_days` approved days (default 10) are not ranked.
  - Ties share a rank (1, 2, 2, 4).
- **Who sees rankings.**

  | Who | What they see |
  |---|---|
  | Admins | Everyone |
  | Team managers | Their teams, when `leaderboard_managers` is on (default on). When it is off, Team performance and profiles still load, with `ranks_hidden: true` and no ranks. |
  | Workers | Only when `leaderboard_workers` is on (default off), and then names and scores only |

- **Workers' own score.** A worker (own scope) reads their score and history, on the web routes and in the desktop app, only when `workers_see_own_score` is on (default off; 403 otherwise). The profile route is for managers and admins only.
- **Profiles.** Goals and achievements on a profile follow `goals:read` and `achievements:read`. Without them, those sections are empty, not an error.

- **Reviews.**
  - The private note goes only to people with `reviews:read` over the member. It is never sent to the member or a client.
  - The audit log records `private_note_changed`, never the note's text.
- **Workers use the desktop app only.** There is no worker web workspace.
- **The client portal** shows delivery facts for the client's own projects only. It never shows money, rates, scores, rankings, reviews, screenshots or activity.
- **Awards.**
  - One award per achievement, recipient, level and period (a unique index).
  - Automatic grants use `onConflictDoNothing`, so re-delivered events change nothing.
  - Revoking keeps the row.
  - Nobody can recognize themselves.

## 2. Phase status

| Phase | Backend | Web UI | Desktop | Tests |
|---|---|---|---|---|
| 1 Foundation | ✅ Done | ✅ Roles screen labels; Performance group in the sidebar; **Performance overview page** | n/a | ✅ Domain, database, API, E2E (roles, `performance-overview.spec.ts`) |
| 2 Achievements | ✅ Done | ✅ Achievements page (appreciation, waiting for approval, awarded) | ✅ Badges on My performance | ✅ API · ✅ E2E |
| 3 Leaderboards and team performance | ✅ Done | ✅ Leaderboards, Team performance | n/a | ✅ API · ✅ E2E |
| 4 Worker performance and reviews | ✅ Done | ✅ Worker list and profile, reviews | n/a | ✅ API · ✅ E2E |
| 5 Goals and client insights | ✅ Done | ✅ Goals, project Milestones tab, portal Insights | n/a | ✅ API · ✅ E2E |
| 6 Desktop "My performance" | ✅ Done | n/a | ✅ IPC, nav, page | ✅ API · ✅ E2E |
| 7 Final QA | ✅ Done, except the bundle budget (see Known issues) | | | ✅ Full regression, security pass, docs |

## 3. What is built

### Domain: `packages/domain/src/performance.ts` (pure, no I/O)

- **Weights:** `PERFORMANCE_METRICS`, `DEFAULT_PERFORMANCE_WEIGHTS`, `weightIssues`, `assertValidWeights`.
- **Normalizing:** `ratioScore`, `ratingScore` (rating 1–5 maps to 0–100), `metricValues`, `computeScore` (returns `score`, `coverage` and the parts with their effective weights).
- **Periods:** `PERFORMANCE_PERIODS` (WEEK, MONTH, QUARTER, YEAR), `periodBounds`, `awardPeriodKey`.
- **Achievements:**
  - `ACHIEVEMENT_TIERS`, `ACHIEVEMENT_CATEGORIES`, `ACHIEVEMENT_METRICS`.
  - The metrics are TASKS_COMPLETED, ON_TIME_MONTHS, MILESTONES_ON_TIME, CONSISTENT_WEEKS, APPROVED_HOURS and TOP_SCORE.
  - `thresholdIssues`, `tiersReached`, `ACHIEVEMENT_ICONS`.
  - `BUILTIN_ACHIEVEMENTS`: 10 built-ins, including `client_hero`. `SYSTEM_ONLY_ACHIEVEMENTS` lists the ones only the system gives.
- **Goals:**
  - `GOAL_SUBJECTS`: MEMBER, TEAM, PROJECT, ORG.
  - `GOAL_METRICS`: TASKS_COMPLETED, MILESTONES_COMPLETED, APPROVED_HOURS, ON_TIME_PCT.
  - `goalMetricAllowed`, and `evaluateGoal`, which returns the status (ACTIVE, COMPLETED or MISSED), progress and pace (AHEAD, ON_TRACK or AT_RISK).
- **Rankings:** `rankEntries` (competition ranking within groups).

### Permissions: `packages/domain/src/permissions.ts`

| Permission | Admin | Team manager | Worker |
|---|---|---|---|
| `performance:read` | org | team | own |
| `performance:manage` (org only) | org | — | — |
| `goals:read` | org | team | own |
| `goals:manage` | org | team | — |
| `achievements:read` | org | team | own |
| `achievements:manage` (org only) | org | — | — |
| `achievements:award` | org | team | — |
| `reviews:read` | org | team | — |
| `reviews:manage` | org | team | — |

- Migration 0030 gives the built-in roles of existing organizations these grants. Custom roles are left alone.
- The desktop device allowlist (`deviceGrants`, `packages/api/src/services/agent-me.ts`) now includes `performance:read`, `goals:read` and `achievements:read` at own scope.
- `docs/security/authorization-matrix.md` has been regenerated.
- The Roles screen shows labels for the new permissions (`apps/web/components/settings/permission-labels.ts`).

### Database: `packages/db/src/schema/performance.ts`, migration `0030_performance_center.sql` (re-runnable)

| Table | Purpose |
|---|---|
| `performance_rules` | Versioned weights and minimum eligible days. Immutable rows. |
| `performance_settings` | `leaderboard_workers`, `leaderboard_managers`, `workers_see_own_score`. |
| `project_milestones` | Title, due date, completed at and by, client-visible flag, position, archived. |
| `performance_goals` | Subject check constraint, target > 0, end ≥ start. |
| `performance_goal_progress` | Append-only history. Unique per goal and `source_key`. |
| `achievement_definitions` | Built-in (with `key`) or custom. Mode check constraint. |
| `achievement_awards` | Unique per definition, recipient, tier and period. Revocable. Member or team recipient. |
| `performance_reviews` | Rating 1–5, strengths, improvements, recommendations, `private_note`, shared flag, DRAFT or FINAL. |
| `performance_score_snapshots` | One per subject (MEMBER, TEAM, PROJECT, ORG) and period, with the rule id and version, metrics and `final` flag. |
| `client_appreciations` | PENDING, APPROVED or DECLINED. |

Every table has `organization_id`, composite foreign keys and row-level security (applied automatically by `applyRls`).

### API: `packages/api/src`

- **Services:**

  | File | What it covers |
  |---|---|
  | `services/performance.ts` | Rules and settings; milestones; `memberMetricInputs`, `memberScore`, `snapshotMemberScore`, `listMemberSnapshots` |
  | `services/performance-access.ts` | Team and member scope helpers, role family |
  | `services/achievements.ts` | Catalogue, manual awards and revoking, visibility of private awards, the automatic engine (`evaluateMemberAchievements`, `monthlyTopPerformers`, `grantAutomatic`) |
  | `services/goals.ts` | Create, update and read; `measureGoal` from source data; `recalcGoal` and `recalcActiveGoals` (idempotent per source key) |
  | `services/leaderboards.ts` | `refreshPerformance` (member, team, project and organization snapshots); `leaderboard`; `teamPerformance`; `performanceOverview`; `memberPerformanceList`; `memberProfile` |
  | `services/reviews.ts` | Create, update, list and archive; `sharedReviewsFor` (no private note) |
  | `services/portal-insights.ts` | `portalInsights`, `submitAppreciation`, `listAppreciations`, `decideAppreciation` (approving grants Client Hero) |
  | `services/my-performance.ts` | The desktop's own data |
  | `services/performance-jobs.ts` | `handlePerformanceEvent` and `performanceDaily` |

- **Events:**
  - New, emitted here: `task.completed` (from `upsertTask`), `milestone.completed`, `performance.rules.changed`, `achievement.unlocked`, `recognition.awarded`, `goal.created`, `goal.progress.updated`, `goal.completed`, `performance.review.created`.
  - Consumed in `jobs/index.ts` `handleEvent`:
    - `task.completed` re-checks TASKS_COMPLETED achievements and goals.
    - `milestone.completed` re-checks MILESTONES_ON_TIME (members of the project) and MILESTONES_COMPLETED goals.
    - `timesheet.approved` re-checks APPROVED_HOURS and CONSISTENT_WEEKS, and APPROVED_HOURS goals.
  - Daily (`runDaily` calls `performanceDaily`):
    - Snapshots for the current and previous WEEK, MONTH, QUARTER and YEAR. The previous periods become final.
    - Monthly Top Performer for last month.
    - Recalculates every active goal, which also marks overdue goals MISSED.
    - Streak achievements.
- **Notification types:** `achievement.unlocked`, `recognition.awarded`, `goal.created`, `goal.completed`, `performance.review_shared`, `appreciation.received`.

### Endpoints

**Organization routes** (`/api/v1/orgs/:orgId`; `routes/performance.ts`; no API-key access):

| Endpoint | Gate |
|---|---|
| `GET /performance/settings` | `performance:read` |
| `PUT /performance/settings` | `performance:manage` |
| `POST /performance/recalculate` `{period, date?}` | `performance:manage` (open periods only; 422 `period_closed` otherwise) |
| `GET /performance/overview?period&date&team_id&project_id` | team or org scope |
| `GET /performance/leaderboard?type=workers\|teams\|projects&period&date&compare=role\|everyone` | visibility settings above |
| `GET /performance/teams?period&date&team_ids` | |
| `GET /performance/members?period&date` | |
| `GET /performance/members/:id/score?from&to` | |
| `GET /performance/members/:id/profile?period&date` | |
| `GET /performance/members/:id/history?period` | |
| `GET /performance/achievements?archived` | `achievements:read` |
| `POST /performance/achievements` | `achievements:manage` |
| `POST /performance/achievements/:id/archive\|restore` | `achievements:manage` |
| `GET /performance/awards?membership_id&team_id&from&to&limit` | `achievements:read` |
| `POST /performance/awards` | `achievements:award` |
| `POST /performance/awards/:id/revoke` `{reason}` | `achievements:award` |
| `GET /performance/appreciations?status` | `achievements:award` |
| `POST /performance/appreciations/:id/approve\|decline` | `achievements:award` |
| `GET /performance/goals?status&subject_type&membership_id&team_id&project_id` | `goals:read` |
| `POST /performance/goals` | `goals:manage` |
| `GET /performance/goals/:id` | `goals:read` (includes history, `can_manage`) |
| `PATCH /performance/goals/:id` | `goals:manage` |
| `GET /performance/members/:id/reviews` | `reviews:read` |
| `POST /performance/reviews` | `reviews:manage` |
| `PATCH /performance/reviews/:id` | `reviews:manage` |
| `DELETE /performance/reviews/:id` | `reviews:manage` |
| `GET /projects/:id/milestones` | project read |
| `POST /projects/:id/milestones` | project manage |
| `PATCH /milestones/:id` `{…, completed}` | project manage |
| `DELETE /milestones/:id` | project manage |

**Client portal:**
- `GET /api/v1/portal/:accessId/insights`
- `POST /api/v1/portal/:accessId/appreciations`, limited to 10 per hour

**Desktop app:**
- `GET /api/v1/agent/me/performance` returns `week`, `goals`, `badges`, `recognition`, `next_badge`, `milestones`, `score` (null unless `workers_see_own_score`), `trend` and `reviews` (shared, without the private note).

### Contracts: `packages/contracts/src/performance.ts`

- **Inputs:** `performanceSettingsInput`, `performanceWeightsInput`, `milestoneInput`, `milestonePatchInput`, `scoreQuery`, `goalInput`, `goalPatchInput`, `achievementDefinitionInput`, `awardInput`, `reviewInput`, `performanceFilter`, `appreciationInput`.
- **DTOs:** `PerformanceSettingsDto`, `MilestoneDto`, `MemberScoreDto`, `GoalDto`, `AchievementAwardDto`.
- Other response shapes are typed by the service return types.

### UI groundwork (started)

- **Design tokens** (`packages/ui/src/tokens.css`): `--color-tier-{bronze,silver,gold,platinum}` and `-soft`, for light and both dark blocks. Use them as `bg-tier-gold`, `text-tier-gold`, `bg-tier-gold-soft`.
- **`apps/web/components/performance/ui.tsx`:** `HexBadge`, `ScoreRing`, `Sparkline`, `HeroBand`, `HeroTile`, `usePerfPeriod` and `PeriodPicker`, plus the metric labels, colours, icons and tier helpers.
  - It is not used by any page yet.
  - Its `t('perf.…')` keys are **not in `apps/web/messages/en.ts` yet**. Add them, listed in section 5.

## 4. Tests (run and passed on 5 November 2026)

| Suite | Result |
|---|---|
| `pnpm --filter @tallywork/domain test` | 101 passed (`test/performance.test.ts`: 30) |
| `pnpm --filter @tallywork/db test` | 29 passed (`test/performance.test.ts`, plus the 0030 re-run and role-backfill test in `migrations.test.ts`) |
| `pnpm --filter @tallywork/api test` (4 workers) | 73 files, 781 passed, 2 skipped (`performance-foundation.test.ts`: 20, `performance-center.test.ts`: 35) |
| `pnpm typecheck` | 8 of 8 workspaces |
| `e2e/tests/web/performance-permissions.spec.ts` | 3 passed |
| Full E2E regression after phase 1 | 726 passed, 3 failed (see Known issues) |
| **Final QA, 6 November 2026:** `pnpm typecheck` | 8 of 8 workspaces |
| `pnpm test` (all Vitest suites and the full Playwright regression) | Exit 0. api 794 passed, 2 skipped (75 files); web 120; desktop 94; db 29; ui 32; domain passed. E2E: 823 tests, Playwright status "passed", 0 failed |

**What the API tests cover:**
- **Permissions:** admin, manager-team and worker-own scope; cross-tenant 404s.
- **Validation:** weights, goals, reviews, achievements.
- **Awards:** duplicates (409), self-recognition, private awards, revoking.
- **Engine:** automatic levels, idempotent re-delivery, milestone unlocks, goals measured from tasks and missed when overdue.
- **Reviews:** confidentiality.
- **Leaderboards:** visibility toggles.
- **Pages' data:** team performance, the overview, profiles, monthly top performer.
- **Client portal:** no money or performance data in insights, hidden milestones, appreciation approval.
- **Desktop:** own data only, score only when shared.

## 5. Remaining work (next implementation)

### Web (`apps/web`)

**Done (6 November 2026):** five pages, under one sidebar item.
- **Sidebar:** a collapsible Performance group after Reports, marked New (as in the design), with one item per page: Performance overview, Achievements, Leaderboards, Team performance, Worker performance, Goals & challenges. Its four new icons add about 0.5 KB to every page's first load (see Bundle budget).
- **Pages (`app/o/[orgId]/performance/…`):** Overview (with the Scoring rules dialog), Achievements & recognition (catalog, awarded, client appreciation waiting, Recognize someone, Create achievement, revoke), Leaderboards (podium, ranked table, visibility switches), Team performance (up to three teams, score over time, people, side by side), Worker performance (list and profile, with manager reviews and the private note).
- **E2E:** `e2e/tests/web/performance-{overview,achievements,leaderboards,teams,workers}.spec.ts` (32 tests), plus all five pages in `a11y-sweep` and `mobile-sweep`.
- **Text:** `components/performance/messages/*.ts`, one catalog per page plus `core` (shared) and one per form (`achievement-forms`, `reviews`, `rules`). Each file registers itself when imported; import the page's catalog in the page and the form's catalog in the form. Check with a search that every `t('perf.…')` key is in a catalog the file loads.
- **Not built, because the API does not return the data (not faked):** Achievements "History" tab (revoked awards are never returned); Leaderboards "Past winners"; Team performance's five-part score strip (no per-team consistency or quality); the profile's "vs role median".
- **Text:** the `perf.*` strings live in `components/performance/messages.ts` and are registered by `components/performance/i18n.ts`. Performance code imports `t` from there. They are not in `messages/en.ts`, so they stay out of every other page's first load. Only the sidebar labels (`nav.group.performance`, `nav.item.*`) go in `messages/en.ts`, and each new sidebar item also needs a line in `NAV_GUIDE` (`components/help/content.ts`).
- **Bundle budget:** every Performance page is under 250 KB (246.5–249.6 KB). What keeps them there: the achievement icons, the dialogs and forms, the Overview body and the reviews panel load with `React.lazy` (not `next/dynamic`, which added about 1 KB); the Overview body and reviews panel are fetched as soon as the page loads, in parallel with the data. Before this work the branch already had 19 routes over budget (avatar and chart commits). Payroll is now just over (250.2 KB, from 249.5): every page carries the Performance sidebar item and the uncommitted `packages/ui/src/overlays.tsx` menu change, which is not part of this work.
- **Not shown on the Overview, because the API has no data for them (not faked):** the design's custom date range, "biggest climb", "goals due this week", team ranges on the score trend (`lowest_team`/`highest_team` are always null) and the 4-week attendance heatmap. The overview's `previous_score` covers the whole previous period, not the same days, so the hero says "than the previous period".
- **Goals & challenges** (`performance/goals`): summary counts, team challenges, filters by subject and status, goal cards that say where progress comes from, a drawer with the progress history, and New / Edit / Archive for people with `goals:manage` (team or org). Only measures that apply to the subject are offered (`goalMetricAllowed`); what a goal is for and how it is measured cannot change after it is set. E2E: `performance-goals.spec.ts` (6 tests).
- **Project Milestones tab** (project page, after Tasks; `components/performance/project-milestones.tsx`, loaded when the tab opens): milestones by due date with Done on time / Done late / Overdue / Open and whether the client sees them; with `projects:manage`, add, mark done or reopen (the box changes at once and goes back if refused), edit, hide from the client and delete. A done milestone keeps its due date. E2E: `e2e/tests/web/project-milestones.spec.ts` (3 tests) and the mobile sweep.
- **Client portal Insights tab** (`app/portal/[accessId]`: Dashboard · Insights; `components/portal/portal-insights.tsx`, loaded when the tab opens): completion, tasks, milestones and on-time headline numbers; delivery per project; the milestone timeline (client-visible milestones only); tasks completed per week; and "Appreciate the team" (a project, optionally one person on it, and a message), held for the organization's approval. Delivery facts only. The admin "Preview as client" keeps showing the dashboard only. E2E: `e2e/tests/web/portal-insights.spec.ts` (with axe and phone width).
- The "client sent appreciation" notification (`/performance/achievements?tab=appreciation`) opens the Waiting for approval tab.
- **The web UI is complete.**

### Desktop "My performance" (done, 6 November 2026)
- `'performance'` in `ME_RESOURCES` (the main process forwards `GET /agent/me/performance` like the other own-data resources); a "My performance" sidebar item between Schedule and Pay stubs; notifications that link to `/performance…` open it (`viewForLink`).
- `apps/desktop/src/renderer/src/PerformancePage.tsx`: this week (approved time, tasks, consistency streak, badges), the score and recent months only when the organization shares scores, goals with pace, the next badge, badges, recognition with what was said, milestones on the worker's projects, and reviews shared with them (never the private note). A Refresh button.
- **Offline:** the last good copy is kept per person in local storage and shown, labelled with when it was saved, when a refresh fails; with nothing saved, the error and Try again.
- The shared page helpers in `Pages.tsx` (`Page`, `Card`, `Status`, `Stat`, `Badge`) are exported for it.
- Tests: `apps/desktop/test/nav.test.ts`; E2E `e2e/tests/desktop/performance.spec.ts` (5, serial: one switches score sharing for the shared organization), plus the screen in `navigation`, `accessibility` and `a11y`.

1. **Navigation** (`components/shell/nav.ts`): add the group `nav.group.performance`, placed after Reports, with:
   - `/performance`: `nav.item.performanceOverview`, gated by `performance:read`, minScope `team_or_org`, icon `Gauge`.
   - `/performance/achievements`: `nav.item.achievements`, `achievements:read`, `team_or_org`, icon `Award`.
   - `/performance/leaderboards`: `nav.item.leaderboards`, `performance:read`, `team_or_org`, icon `Trophy`.
   - `/performance/teams`: `nav.item.teamPerformance`, `performance:read`, `team_or_org`, icon `Users`.
   - `/performance/workers`: `nav.item.workerPerformance`, `performance:read`, `team_or_org`, icon `UserCheck`.
   - `/performance/goals`: `nav.item.goals`, `goals:read`, `team_or_org`, icon `Target`.
   - Add the labels to `messages/en.ts`.
2. **Pages** under `app/o/[orgId]/performance/` (layouts are on the design canvas):
   - **`page.tsx` (Overview):** `GET /performance/overview`.
     - The highlight band with `ScoreRing` built from `parts`.
     - KPI strip: workers, teams, achievements, goals, team goal completion, project delivery.
     - Panels: score trend (`score_trend`), what the score is made of (`parts` with `metricSource`), teams, achievements by month (stacked by tier), goals by month, project delivery (`projects[].steps`), recent recognition.
     - Filters: period, team, project.
     - A "Scoring rules" dialog that PUTs settings (admins only; validates the 100% total before sending).
     - A "Recalculate" button for admins.
   - **`achievements/page.tsx`:**
     - Tabs: Catalog, Awarded, Waiting for approval, History.
     - Category chips; achievement cards with `HexBadge`, level ladder and earned counts.
     - "Create achievement" dialog for admins.
     - "Recognize someone" form: member or team, achievement filtered by `awardable`, reason, public or private, notify.
     - Client appreciation approve and decline; revoking with a reason.
   - **`leaderboards/page.tsx`:**
     - Tabs: workers, teams, projects. Period: week, month, quarter, year, and custom via `date`. Compare within: role or everyone.
     - Top-3 podium (`HexBadge` with initials), ranked table (`movement`, `trend` with `Sparkline`), "How ranking works", the visibility switches (PUT settings), past winners from `history`.
     - Show the 403 message when rankings are turned off for the viewer.
   - **`teams/page.tsx`:** team picker (compare up to 3, `team_ids`), team cards with a five-segment score strip (unmeasured metrics hatched), a line chart of `history`, a side-by-side table, and the people list.
   - **`workers/page.tsx`** (`GET /performance/members`) and **`workers/[id]/page.tsx`** (`GET .../profile` and `GET .../reviews`):
     - Header with the score ring, KPIs, tabs, score over time, the breakdown against the role median, contributions, goals, the badge shelf.
     - Manager feedback: the reviews list, an add or edit review dialog, the private note clearly marked "never shown to the member".
     - The score history.
   - **`goals/page.tsx`:**
     - The challenge band (team goals racing), summary counts, type and status filters, goal cards showing their source.
     - A goal detail drawer with history (`GET /performance/goals/:id`).
     - "New goal" dialog, with the subject picker filtered to people, teams and projects the actor can manage, and the metric list filtered with `goalMetricAllowed`.
   - Every page needs loading (`SkeletonRows`), error (`ErrorState`), empty (`EmptyState`) and permission (`PermissionState`) states.
   - Use only `t(key)`; add all `perf.*` keys to `messages/en.ts`.
   - Charts come from `@/components/charts-lazy` (bundle budget).
3. **Translations used by `components/performance/ui.tsx`, to add:**
   - `perf.metric.{goals,delivery,consistency,quality,attendance}`
   - `perf.metricSource.{same}`
   - `perf.tier.{bronze,silver,gold,platinum}`
   - `perf.score`, `perf.notEnoughData`, `perf.notMeasured`, `perf.of100`, `perf.of`
   - `perf.previousPeriod`, `perf.nextPeriod`, `perf.current`, `perf.periodLabel`
   - `perf.period.{week,month,quarter,year}`
4. **Project page:** a Milestones panel (list, add, complete, reopen, archive, client-visible toggle) on the project detail page, using the milestone endpoints. Milestones are the source of delivery scores and goals.
5. **Client portal:** an "Insights" tab next to the dashboard (`apps/web/components/portal/portal-dashboard.tsx`), from `GET /portal/:accessId/insights`.
   - KPIs: completion, tasks done and open, milestones, on time.
   - A milestone timeline, tasks per week, delivery progress per project.
   - An "Appreciate the team" form (`POST .../appreciations`, people from `contributors`).
   - It must show no money or performance data.

### Desktop (`apps/desktop`)

6. **IPC and navigation:**
   - Add `'performance'` to `ME_RESOURCES` (`src/shared/ipc.ts`). The main process proxies `GET /agent/me/performance`.
   - Add a "My performance" nav item (`src/renderer/src/nav.ts` `NAV_GROUPS`, `GROUP_OF`, the Shell icon map, the `App.tsx` switch, and `lib.ts` types).
   - Update `apps/desktop/test/nav.test.ts`.
7. **Page (`Pages.tsx` or a new `PerformancePage.tsx`):**
   - A "This week" card with targets, approved time, tasks and streak.
   - My goals, my milestones, the next badge, the badge grid, recognition.
   - Score and trend only when `score` is not null; shared reviews.
   - Offline: show the cached copy, labelled as such.

### Tests still to write and run

8. **Web E2E** (`e2e/tests/web/performance-*.spec.ts`; tag the main journeys `@smoke`):
   - Overview loads with demo data.
   - Create a custom achievement; recognize a team member; duplicate refused.
   - Leaderboards: tabs, period, the visibility switch, a worker refused when it is off.
   - Team comparison; worker profile with a review (private note hidden from the worker).
   - Create a goal, then complete it by finishing tasks.
   - Milestones panel; portal Insights and appreciation; empty and error states.
   - Phone width and dark theme (axe, no sideways scroll).
   - Add the new pages to `e2e/tests/web/mobile-sweep.spec.ts` and `a11y-sweep.spec.ts` if they use `DataTable`.
9. **Desktop E2E** (`e2e/tests/desktop/performance.spec.ts`): the "My performance" page with the worker's own data, no score unless shared, no other people.
10. **Phase 7:**
    - The full regression: `pnpm test:e2e`, `pnpm test`, `pnpm typecheck`.
    - The bundle budget: `node apps/web/scripts/check-bundle-budget.mjs`, which must stay ≤ 250 KB for the new routes.
    - A security pass on the new routes.
    - A README and API docs update (`docs/api/README.md`: client portal and desktop endpoints).

## 6. Known issues and notes

- **Fixed after the pre-UI review (5 November 2026):** the items above on settling, old-date reads, concurrent saves, own-score and manager-rank visibility, and profile permissions. Also:
  - The overview's achievements-by-month now covers its six months with any period (it missed older months with WEEK).
  - Performance work no longer runs inside other jobs. For an outbox event, it runs in a savepoint after the event's notifications and webhooks. If it fails, it is queued as an internal `performance.retry` event (never sent to webhooks) and retried on its own. The daily step has its own transaction, so a failure there never rolls back retention, accruals or overdue invoices.
  - The dashboard time-off rows include `membership_id`, so the widget shows profile pictures.
  - The lockfile matches `pnpm install --frozen-lockfile` again (CI installs this way). The one-off production check script `packages/db/scripts/check-prod.mjs` was removed.
  - Tests: `packages/api/test/performance-integrity.test.ts`, `performance-jobs-isolation.test.ts`, and `isPeriodSettled` in `packages/domain/test/performance.test.ts`.

- **API tests with default parallelism:** some Vitest workers die with "Fatal process out of memory: Zone" (a V8 limit when many in-memory Postgres instances start at once; 14 GB RAM was free). `--maxWorkers=4` passes everything. Consider setting `maxWorkers` in `packages/api/vitest.config`.
- **E2E failures after phase 1:**
  - `qa/people-flows.spec.ts` "cancelling your own request": the floating calculator button covers the row's Cancel button. A real overlap, from before this work.
  - `desktop/startup-transparency.spec.ts`: two tests timed out while the machine was loaded by other test runs. Re-run them on their own.
- **Snapshot load:** `refreshPerformance` runs once per period type each day, and computes attendance for every active member. That is fine for today's organization sizes. For large organizations, move it to a queue or batch it.
- **Automatic achievements:**
  - MILESTONES_ON_TIME credits a project's direct members (`project_members`), not members who join only through a team.
  - TOP_SCORE is given from final monthly snapshots in the daily job.
- **Multiple Client Hero awards:** each approved client appreciation is a separate award (`period_key` = `appreciation:<id>`).
