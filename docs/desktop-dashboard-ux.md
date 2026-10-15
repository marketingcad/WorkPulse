# Desktop worker dashboard — UI/UX map

This documents the **worker's desktop app** dashboard (`apps/desktop/src/renderer`): every screen, where
its data comes from, and how the **system admin** drives it. Section 5 keeps the simplification analysis
that led to the current layout and records what was done with each recommendation.

Audience: engineers and designers working on the desktop app. Function and file names are the source of
truth; line numbers drift.

The renderer is **10 files**: `App.tsx`, `Shell.tsx`, `nav.ts`, `Pages.tsx`, `Dashboard.tsx`,
`HomeCards.tsx`, `lib.ts`, `types.ts`, `main.tsx` and `styles.css`, plus the shared `shared/ipc.ts` and
`preload/index.ts`.

> **Changed on 15 October 2026 (not in a desktop release yet; the last release is 0.1.4):**
> - The "What is monitored" screen, its first-run acknowledgement and the rule that blocked the timer
>   until a worker acknowledged the policy were removed.
> - The navigation became seven sidebar items with no "Me" group.
> - Settings lost its technical details.
> - The profile menu now holds only Sign out.

---

## 1. How the app is structured

There is **no URL router**. The root `App` ([App.tsx](../apps/desktop/src/renderer/src/App.tsx)) holds a
single `view` string in React state and gates the whole render on `AgentState.phase`, in this order:

1. no state → blank background
2. `signed_out` / `signing_in` → **Sign in** (progressive: password → MFA → org; "sign in with browser"; collapsible server settings)
3. no account → loading spinner
4. `recoveryPrompt` → **Recovery** ("WorkPulse closed unexpectedly")
5. otherwise → the selected page inside `Shell`
6. `idlePrompt` → **Idle** sheet overlaid on top of everything

There is no first-run policy screen: after signing in, a worker lands on Home and can start the timer.

### The sidebar — 7 items

The sidebar is plain data in [nav.ts](../apps/desktop/src/renderer/src/nav.ts) (`NAV_GROUPS`), rendered by
[Shell.tsx](../apps/desktop/src/renderer/src/Shell.tsx) and unit-tested in
[nav.test.ts](../apps/desktop/test/nav.test.ts). The items are **Home, Track, Timesheet, Time off,
Schedule, Pay stubs and Settings**. Two of them open a tab bar for related screens:

- **Track** → Projects · Tasks · Sessions (the Time Tracking page)
- **Timesheet** → Timesheet · Activity · Reports

`GROUP_OF` maps every view to its sidebar item, so the right item stays highlighted on a tab. The sidebar
shows on screens ≥1024px and collapses to a drawer behind the menu button below that.

One sub-screen is **not in the sidebar**: **Add manual time** (`manual`), reached from Time Tracking and
the Home quick actions.

The **header bar** carries: org name, Online/Offline pill, sync status ("Synced 2m ago / Syncing… / N
saved"), the notifications bell, and the profile menu (name, email, organization, **Sign out**).

---

## 2. Screen-by-screen inventory

| Screen | Shows | Reads from | Worker can |
|---|---|---|---|
| **Home** | Greeting, Timer card, Needs attention, Quick actions, Current session, Recent sessions, Today summary, Activity card | Live state + `useMe('summary'\|'sessions')` | Start/stop/pause/break, pick project+task, add note, jump to manual time / timesheet |
| **Time Tracking** (Track → Sessions) | Sessions grouped by day, period selector (7/14/30d) | `useMe('sessions',{from,to})` | Add manual time |
| **Projects** (Track) | Assigned projects (search, expand to tasks), "this week" per project | Live `assignments` + `useMe('summary')` | Click a project/task to start tracking |
| **Tasks** (Track) | Tasks grouped by project; Open/Done/All filter; status, priority, due, tracked time | `useMe('tasks')` | Start / switch to a task |
| **Timesheet** | Period stepper, totals (expected, added by hand, activity), hours-by-day matrix, status, rejection banner. No billable hours | `useMe('timesheet',{date})` | Submit / resubmit |
| **Activity** (Timesheet) | Day stepper, tracked/avg-activity/blocks, 10-min blocks by hour, top apps & websites | `useMe('activity',{date})` | — (read-only) |
| **Reports** (Timesheet) | Preset range, worked/added by hand/activity/away, hours-by-day chart, by-project list | `useMe('summary',range)` | — (read-only) |
| **Time Off** | Balance cards (balance/used/pending), request form, your requests | `useMe('time-off')` | Request time off |
| **Schedule** | This/next week shifts, day off, today highlight | `useMe('schedule',{from,to})` | — (read-only) |
| **Pay Stubs** | Finalized payrolls: period, hours, gross/net, adjustments | `useMe('pay-stubs')` | Download PDF |
| **Settings** | Signed in as, organization, this device (status in words), version, sync error if any | Live state | Sign out, Quit |
| **Add manual time** | Project/task/date/time/reason form, pending requests | Live state | Request manual time |

### The Home dashboard in detail

A two-column grid ([Dashboard.tsx](../apps/desktop/src/renderer/src/Dashboard.tsx)). Main column, top to
bottom: **Greeting → Timer card → Needs attention → Quick actions → Current session + Recent sessions**.
Aside column: **Today summary → Activity card**.

- **Timer card:** a "Working on" line with project and task. While tracking, the pickers stay behind a
  "Change" button. It also has the status, a live HH:MM:SS clock, a "Today Xh · Week Yh" line and the
  Start / Break / Pause / Resume / Stop buttons, with breaks in a menu.
- **Needs attention:** appears only when the worker has something to act on, either a timesheet to
  submit or fix, or manual-time requests still waiting to sync.
- **Quick actions:** a work note (while tracking), **Manual time** (when the policy allows it) and **My
  timesheet**.
- **Activity card:** the last hour of activity per minute.

---

## 3. The data layer — "live" vs "fetched"

Everything goes through the typed preload bridge `window.tallywork` (no raw `ipcRenderer`). There are two
mechanisms:

**(A) Live pushed state — `AgentState`** ([shared/ipc.ts](../apps/desktop/src/shared/ipc.ts), subscribed via
`useAgentState()` in [lib.ts](../apps/desktop/src/renderer/src/lib.ts)). Main pushes a new state object and
the UI re-renders. This carries:
- the timer (state, project, task, started-at, base and segment seconds, note);
- today and week seconds, activity %, recent per-minute activity, and what's recording now;
- idle and recovery prompts;
- sync status, capabilities, policy, assignments, break types, next shift, timesheet-due and manual
  requests.

The clock is ticked client-side.

**(B) Fetched own-data — `useMe`** → `GET /api/v1/agent/me/<resource>`. The allowlist is: `summary`,
`sessions`, `timesheet`, `activity`, `tasks`, `schedule`, `time-off`, `notifications`, `client-visibility`,
`pay-stubs`. It keeps the last good result on failure, so pages still show data offline.
`client-visibility` is still allowlisted, but no screen reads it since "What is monitored" was removed.

**Bridge commands** (mutations) go to the main process, which owns the session and sync: `start`,
`switchTask`, `stop`, `pause`, `resume`, `takeBreak`, `setNote`, `resolveIdle`, `resolveRecovery`,
`requestManualTime`, `submitTimesheet`, `requestTimeOff`, `readNotifications`, `savePayStub`. The timer
verbs are **not** REST calls — they're commands to main.

Rule of thumb: **the timer, activity-now, sync, assignments, policy, breaks, shifts, and timesheet-due are
live; history (sessions, summaries, timesheet, activity, schedule, time-off, pay stubs, notifications) is
fetched.**

---

## 4. How the system admin drives the worker's UI

The worker's screen is almost entirely a reflection of what the admin configured on the server. The two
carriers are `AgentState.policy` and `AgentState.assignments`.

| Admin sets (web) | Where it surfaces on the desktop |
|---|---|
| Monitoring policy (activity, screenshots, apps, websites, location, idle) | What the agent records while the timer runs; the Activity page's apps and websites lists say "Not recorded by your organization" when off. The worker is no longer shown a summary of the policy or asked to acknowledge it. |
| Desktop tracking allowed | Starting the timer is refused when the organization turns desktop tracking off |
| Time limits (daily/weekly) | Progress bars in Today summary; the timer stops at a limit |
| Manual-time rules (allowed, needs approval, reason required) | Whether the manual-time buttons appear; required-reason and approval copy |
| Idle rules (threshold, behavior) | The Idle sheet prompt and its wording |
| Projects + tasks (membership, assignees) | Every project/task picker, the Projects page, Tasks grouping |
| Break types (paid/unpaid, max minutes) | The Break menu options |
| Schedule / shifts | Schedule page and "Your shift" / next-shift line |
| Time-off policies | Time Off balances and request form (empty state tells the worker to ask their admin) |
| Device approval | Device status in Settings; a PENDING device can't track |

A change the admin makes server-side reaches the worker through the bootstrap/sync cycle (new policy
hash). The desktop shows a "Tracking settings changed" notification and restarts its monitors with the new
policy. It no longer asks the worker to re-acknowledge.

---

## 5. Simplification analysis (history)

This was the analysis behind the current layout. Each item ends with what was done.

> The original analysis said to keep "What is monitored" and its acknowledgement as the transparency
> disclosure, which many places require by law. **That was later reversed:** the screen and the
> acknowledgement were removed on purpose (15 October 2026). If workers must be told what is monitored,
> that now has to happen outside the desktop app. The server's `/agent/policy/ack` endpoint and the web
> `/me/monitoring` page still exist.

### 5.1 Reduce the 11-item nav

Eleven destinations was a lot for a single-worker app, and several were low-interaction, read-only, or
overlapped. The analysis proposed **Home · Track · Timesheet · Time off · Me (schedule, pay stubs,
settings)**, with Reports folded under Timesheet.

**Done, then adjusted:** Track and Timesheet group their screens as tabs, as proposed. The "Me" group was
later split back out, so Schedule, Pay stubs and Settings are separate sidebar items (7 in total).

### 5.2 Remove duplicated paths

- **Starting work two ways:** the Timer card's project/task selects and the Projects card both call
  `bridge.start`. Pick one primary pattern for Home.
- **Sessions two ways:** Recent sessions on Home vs the full Time Tracking page; Home shows a short preview
  with "View all".
- **"Tracked today / week"** appeared on both the Timer card and the Today summary.

**Partly done:** the Projects card is no longer on Home. The Timer card still shows "Today · Week".

### 5.3 Lighten the Timer card

Proposed: move the activity ring out, collapse the break menu, and show project/task as a compact
"working on X" line with an edit affordance.

**Done:** "Working on" line with a "Change" button while tracking; no activity ring on the Timer card.

### 5.4 Translate the jargon

| Was | Now |
|---|---|
| Billable | Hidden from workers |
| Manual | "Added by hand" |
| Idle | "Away" |

**Done** for these three. Activity % is still labelled "Activity".

### 5.5 De-technicalize Settings

Proposed: move capabilities, the device ID and pending sync behind a "Technical details" disclosure.

**Done, then simplified further:** the technical details were removed from Settings entirely.

### 5.6 Calm the "What is monitored" screen

**Superseded:** the screen was removed (see the note at the top of this section).

### 5.7 Reduce interruptive surfaces

The idle sheet and recovery screen still interrupt, as they must. The monitoring gate is gone. Manual time
is still a contextual sub-screen.

### What not to change

- The **two-mechanism data layer** (live state + fetched own-data) is sound and offline-friendly; keep it.
- The **device-only, own-data** security model is deliberate — don't widen what the renderer can read to
  simplify a screen.

---

## 6. Key files

| Area | File |
|---|---|
| Root, phase gating, Sign in, Manual time, Settings, Idle, Recovery | [App.tsx](../apps/desktop/src/renderer/src/App.tsx) |
| App frame, sidebar, sub-tabs, header, notifications, profile menu | [Shell.tsx](../apps/desktop/src/renderer/src/Shell.tsx) |
| Sidebar model: items, tabs, which item each view belongs to | [nav.ts](../apps/desktop/src/renderer/src/nav.ts) |
| Home dashboard: Timer card, Needs attention, Quick actions, Projects card, Activity card | [Dashboard.tsx](../apps/desktop/src/renderer/src/Dashboard.tsx) |
| Home cards: Today summary, Current/Recent sessions, Session list | [HomeCards.tsx](../apps/desktop/src/renderer/src/HomeCards.tsx) |
| Time Tracking, Projects, Tasks, Timesheet, Activity, Reports, Time Off, Schedule, Pay Stubs | [Pages.tsx](../apps/desktop/src/renderer/src/Pages.tsx) |
| Bridge, `useMe`, `useAgentState`, views, formatters | [lib.ts](../apps/desktop/src/renderer/src/lib.ts) |
| `AgentState` shape, IPC channel schema, `ME_RESOURCES` | [shared/ipc.ts](../apps/desktop/src/shared/ipc.ts) |
| Preload bridge | [preload/index.ts](../apps/desktop/src/preload/index.ts) |

See also [desktop-admin-connection.md](desktop-admin-connection.md) for how the desktop app authenticates
and connects to the admin side.
