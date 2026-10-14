# Desktop worker dashboard — UI/UX map and simplification guide

This documents the **worker's desktop app** dashboard (`apps/desktop/src/renderer`): every screen, where
its data comes from, how it's driven by the **system admin**, and — the reason for this doc — where it's
more complex than a worker needs, with concrete ways to simplify.

Audience: engineers and designers working on the desktop app. Function and file names are the source of
truth; line numbers drift.

The whole renderer is **8 files**: `App.tsx`, `Shell.tsx`, `Pages.tsx`, `Dashboard.tsx`, `HomeCards.tsx`,
`lib.ts`, `types.ts`, `main.tsx`, plus the shared `shared/ipc.ts` and `preload/index.ts`.

---

## 1. How the app is structured

There is **no URL router**. The root `App` ([App.tsx](../apps/desktop/src/renderer/src/App.tsx)) holds a
single `view` string in React state and gates the whole render on `AgentState.phase`, in this order:

1. no state → blank background
2. `signed_out` / `signing_in` → **Sign in** (progressive: password → MFA → org; "sign in with browser"; collapsible server settings)
3. no account → loading spinner
4. `recoveryPrompt` → **Recovery** ("WorkPulse closed unexpectedly")
5. `!policyAcknowledged` → **forced "What is monitored" gate** — must acknowledge before tracking
6. otherwise → the selected page inside `Shell`
7. `idlePrompt` → **Idle** sheet overlaid on top of everything

### The navigation rail — 11 destinations

From [Shell.tsx](../apps/desktop/src/renderer/src/Shell.tsx) (`NAV`): **Home, Time Tracking, Projects,
Tasks, Timesheet, Activity, Reports, Time Off, Schedule, Pay Stubs, Settings.** The rail shows on screens
≥1024px and collapses to a hamburger drawer below that.

Two sub-screens are **not in the rail** and are only reachable contextually:
- **What is monitored** (`monitoring`) — from Settings, the profile menu, the header screenshot chip, and the Home activity card.
- **Add manual time** (`manual`) — from Time Tracking and Home quick actions.

The **header bar** carries: org name, Online/Offline pill, sync status ("Synced 2m ago / Syncing… / N
saved"), a "Screenshots on/off" chip, the notifications bell, and the profile avatar.

---

## 2. Screen-by-screen inventory

| Screen | Shows | Reads from | Worker can |
|---|---|---|---|
| **Home** | Greeting, Timer card, Quick actions, Current session, Recent sessions, Today summary, Activity card | Live state + `useMe('summary'\|'sessions')` | Start/stop/pause/break, pick project+task, add note, jump to manual time / timesheet |
| **Time Tracking** | Sessions grouped by day, period selector (7/14/30d) | `useMe('sessions',{from,to})` | Add manual time |
| **Projects** | Assigned projects (search, expand to tasks), "this week" per project | Live `assignments` + `useMe('summary')` | Click a project/task to start tracking |
| **Tasks** | Tasks grouped by project; Open/Done/All filter; status, priority, due, tracked time | `useMe('tasks')` | Start / switch to a task |
| **Timesheet** | Period stepper, totals (expected/billable/manual/activity), hours-by-day matrix, status, rejection banner | `useMe('timesheet',{date})` | Submit / resubmit |
| **Activity** | Day stepper, tracked/avg-activity/blocks, 10-min blocks by hour, top apps & websites | `useMe('activity',{date})` | — (read-only) |
| **Reports** | Preset range, worked/billable/manual/activity/idle, hours-by-day chart, by-project list | `useMe('summary',range)` | — (read-only) |
| **Time Off** | Balance cards (balance/used/pending), request form, your requests | `useMe('time-off')` | Request time off |
| **Schedule** | This/next week shifts, day off, today highlight | `useMe('schedule',{from,to})` | — (read-only) |
| **Pay Stubs** | Finalized payrolls: period, hours, gross/net, adjustments | `useMe('pay-stubs')` | Download PDF |
| **Settings** | Signed-in identity, org, server, device status+id, pending sync, capabilities, version | Live state | What is monitored, Sign out, Quit |
| **What is monitored** | On/Off rows: activity, screenshots, apps, websites, location, idle; warning banners | `policy` + `capabilities` + `useMe('client-visibility')` | Acknowledge policy |
| **Add manual time** | Project/task/date/time/reason form, pending requests | Live state | Request manual time |

### The Home dashboard in detail

A two-column grid ([Dashboard.tsx](../apps/desktop/src/renderer/src/Dashboard.tsx)). Main column, top to
bottom: **Greeting → Timer card → Quick actions → Current session → Recent sessions**. Aside column:
**Today summary → Activity card**.

The **Timer card** is the centerpiece and the densest element: a 3-panel grid with a "current project"
select, a "current task" select, a status pill, a live HH:MM:SS clock, a "Today Xh · Week Yh" line, up to
three buttons (Start / Break+Pause / Stop / Resume), a break menu, an activity ring, and the start time.

---

## 3. The data layer — "live" vs "fetched"

Everything goes through the typed preload bridge `window.tallywork` (no raw `ipcRenderer`). There are two
mechanisms:

**(A) Live pushed state — `AgentState`** ([shared/ipc.ts](../apps/desktop/src/shared/ipc.ts), subscribed via
`useAgentState()` in [lib.ts](../apps/desktop/src/renderer/src/lib.ts)). Main pushes a new state object and
the UI re-renders. This carries: the timer (state, project, task, started-at, base/segment seconds, note),
today/week seconds, activity %, recent per-minute activity, what's recording now, idle/recovery prompts,
sync status, capabilities, policy + acknowledgement, assignments, break types, next shift, timesheet-due,
and manual requests. The clock is ticked client-side.

**(B) Fetched own-data — `useMe`** → `GET /api/v1/agent/me/<resource>`. The allowlist is: `summary`,
`sessions`, `timesheet`, `activity`, `tasks`, `schedule`, `time-off`, `notifications`, `client-visibility`,
`pay-stubs`. It keeps the last good result on failure, so pages still show data offline.

**Bridge commands** (mutations) go to the main process, which owns the session and sync: `start`,
`switchTask`, `stop`, `pause`, `resume`, `takeBreak`, `setNote`, `resolveIdle`, `acknowledgePolicy`,
`resolveRecovery`, `requestManualTime`, `submitTimesheet`, `requestTimeOff`, `readNotifications`,
`savePayStub`. The timer verbs are **not** REST calls — they're commands to main.

Rule of thumb: **the timer, activity-now, sync, assignments, policy, breaks, shifts, and timesheet-due are
live; history (sessions, summaries, timesheet, activity, schedule, time-off, pay stubs, notifications) is
fetched.**

---

## 4. How the system admin drives the worker's UI

The worker's screen is almost entirely a reflection of what the admin configured on the server. The two
carriers are `AgentState.policy` and `AgentState.assignments`.

| Admin sets (web) | Where it surfaces on the desktop |
|---|---|
| Monitoring policy (activity, screenshots, apps, websites, location, idle) | "What is monitored" rows, Home activity card, header screenshot chip. Must be **acknowledged** before tracking. |
| Time limits (daily/weekly) | Progress bars in Today summary; warning on "What is monitored" |
| Manual-time rules (allowed, needs approval, reason required) | Whether the manual-time buttons appear; required-reason and approval copy |
| Idle rules (threshold, behavior) | The Idle sheet prompt and its wording |
| Projects + tasks (membership, assignees) | Every project/task picker, the Projects page, Tasks grouping |
| Break types (paid/unpaid, max minutes) | The Break menu options |
| Schedule / shifts | Schedule page and "Your shift" / next-shift line |
| Time-off policies | Time Off balances and request form (empty state tells the worker to ask their admin) |
| Device approval | Device status in Settings; a PENDING device can't track |
| Client visibility | Warning banner on "What is monitored" naming which clients can see activity/screenshots |
| OS capabilities (e.g. Wayland) | Gate what the monitoring rows show as actually On; trigger the Wayland warning |

A change the admin makes server-side reaches the worker through the bootstrap/sync cycle (new `policyHash`),
and a policy change forces the worker to re-acknowledge.

---

## 5. Simplification analysis

The goal is to make the dashboard easier for workers to use and understand. These are the friction points
the current structure creates, with options to address each. They're ordered by likely impact.

> **Keep "What is monitored" fully intact and reachable.** It's the transparency disclosure, and (in many
> places) a legal requirement. Simplification should make the rest of the app calmer, not hide monitoring.
> It can be made less alarming (see 5.6), but it must stay available to the worker.

### 5.1 Reduce the 11-item nav

Eleven destinations is a lot for a single-worker app, and several are low-interaction, read-only, or overlap:

- **Reports** largely re-presents what **Activity**, **Timesheet** and **Today summary** already show, in
  another cut. Consider folding it into Timesheet/Activity as a "range" view.
- **Schedule** and **Pay Stubs** are read-only reference screens. They could live under a single
  "Me" / "My info" group rather than two top-level items.
- A workable target: **Home · Track · Timesheet · Time off · Me (schedule, pay stubs, settings)** — five
  primary items, with Projects/Tasks reachable from Track/Home.

### 5.2 Remove duplicated paths

- **Starting work two ways:** the Timer card's project/task selects and the Projects-card list both call the
  same `bridge.start`. Pick one primary pattern for Home; keep the other only on the Projects page.
- **Sessions two ways:** Recent sessions on Home vs the full Time Tracking page. Home should show a short
  preview with a single "View all" into Time Tracking — which it does — so the duplication is mostly in how
  prominent both are.
- **"Tracked today / week"** appears on both the Timer card and the Today-summary card. Show it once.

### 5.3 Lighten the Timer card

It currently packs project select, task select, status, clock, today/week, up to three buttons, a break
menu, an activity ring, and the start time into one card. Options: move the activity ring to the Activity
card (where activity lives), collapse the break menu behind the Pause button, and show project/task as a
compact "working on X" line with an edit affordance rather than two always-open selects.

### 5.4 Translate the jargon

Labels a worker may not parse, with plainer alternatives:

| Current | Plainer |
|---|---|
| Billable | (hide from workers, or "Client hours") |
| Manual | "Added by hand" |
| Activity % | "Keyboard & mouse use" |
| Idle | "Away time" |
| ONE_OFF (extra) | "Extra shift" |
| late_seconds / "added or changed after you submitted" | "Changed after you submitted" |
| Supersede | "Replace" |

### 5.5 De-technicalize Settings

Settings currently exposes developer-flavored values: capabilities as `key ✓/✗`, a device-id slice, and
"Pending sync: N events". Workers don't need these. Move them behind a "Technical details" / "Diagnostics"
disclosure and keep the main Settings to identity, org, device status (in words), and the sign-out/quit
actions.

### 5.6 Calm the "What is monitored" screen (without hiding it)

It can stack up to four warning banners (client visibility, Wayland, time limits) above six policy rows.
Rather than remove it, make it calmer: lead with a one-line plain summary ("While your timer runs, your
employer collects …"), show only the signals that are actually On by default with the rest behind "see
all", and consolidate the warning banners. The acknowledgement and the full detail stay.

### 5.7 Reduce interruptive surfaces

The app has many overlays: idle sheet, recovery screen, notifications popover, profile popover, break menu,
inline time-off form, manual-time sub-screen, and the monitoring gate. Audit which truly need to interrupt.
The idle sheet and the monitoring gate must; others (manual time, time-off) could be inline pages reachable
from the nav rather than contextual-only sub-screens, which also fixes the "hard to find again" problem.

### What not to change

- The **two-mechanism data layer** (live state + fetched own-data) is sound and offline-friendly; keep it.
- The **device-only, own-data** security model is deliberate — don't widen what the renderer can read to
  simplify a screen.
- The **monitoring disclosure and acknowledgement** stay.

---

## 6. Key files

| Area | File |
|---|---|
| Root, phase gating, Sign in, Monitoring, Manual time, Settings, Idle, Recovery | [App.tsx](../apps/desktop/src/renderer/src/App.tsx) |
| App frame, nav rail, header, notifications, profile menu | [Shell.tsx](../apps/desktop/src/renderer/src/Shell.tsx) |
| Home dashboard: Timer card, Quick actions, Projects card, Activity card | [Dashboard.tsx](../apps/desktop/src/renderer/src/Dashboard.tsx) |
| Home aside cards: Today summary, Current/Recent sessions, Session list | [HomeCards.tsx](../apps/desktop/src/renderer/src/HomeCards.tsx) |
| Time Tracking, Projects, Tasks, Timesheet, Activity, Reports, Time Off, Schedule, Pay Stubs | [Pages.tsx](../apps/desktop/src/renderer/src/Pages.tsx) |
| Bridge, `useMe`, `useAgentState`, formatters | [lib.ts](../apps/desktop/src/renderer/src/lib.ts) |
| `AgentState` shape, IPC channel schema, `ME_RESOURCES` | [shared/ipc.ts](../apps/desktop/src/shared/ipc.ts) |
| Preload bridge | [preload/index.ts](../apps/desktop/src/preload/index.ts) |

See also [desktop-admin-connection.md](desktop-admin-connection.md) for how the desktop app authenticates
and connects to the admin side.
