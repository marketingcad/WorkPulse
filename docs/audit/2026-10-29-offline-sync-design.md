# Offline sync: recorded time is never dropped (design note, 29 Oct 2026)

This is Phase 2 of [the 28 Oct audit plan](2026-10-28-product-qa-audit.md#h-prioritized-plan). It covers Q6 and Q7, plus BE-4, T7, T9 and T10. The decisions in section 4 were approved on 29 Oct 2026: backfill sessions; accept and flag; keep rejecting time recorded while tracking was disabled; keep duration-only time out of trimming, and flag a day that has both kinds of time.

## 1. What happens today

The desktop app queues events while it is offline and sends them in batches of up to 200 when it reconnects (`apps/desktop/src/main/services/agent.ts`, `sync`).

The server handles each event as if it happened now:

| Step | Code | Problem |
|---|---|---|
| `session.start` for 09:00 arrives at 11:00 | `startSession` | It checks the daily and weekly limit against **today at sync time** (`limitReached(..., input.now)`), not the day the session happened. |
| | | It checks that the project is still active and assigned **at sync time** (`validateTrackTarget`). |
| | | If a session is running (for example a web timer started at 10:00), it **supersedes** it at `max(09:00, 10:00)`. The running segment closes with zero length, the web timer is gone, and 10:00–11:00 is lost (Q6). |
| A rejected start | `ingestBatch` | The event comes back as `rejected`, and the following events in the session fail with `session_not_found`. |
| | Desktop `sync` | It **acknowledges and deletes** rejected events. The time is lost for good (Q7). |

Two things already work as wanted and stay:
- Late time inside a submitted or approved timesheet is kept, locked and flagged (`deriveEntries`, `timesheet.late_time`).
- Moments already covered by another entry keep the earlier record (`uncoveredParts`). No moment is counted twice.

Constraint: the `tracking_sessions_one_live` unique index allows one live session (`CREATED`, `ACTIVE`, `PAUSED` or `INTERRUPTED`) per member.

## 2. The rule

> Tracked time is evidence. A sync may **flag** it for review but never **drops** it, and never ends or shortens a session that started after it.

## 3. Proposed design

### 3.1 Late sessions don't touch the running timer (Q6)

A `session.start` is **late** when a session is live and the start was recorded offline (section 3.2), or happened before the live session began. Only a start happening now takes over a running timer. Without this rule, a web timer started at 08:00 would be superseded at 09:00 by an offline session synced at 11:00, and 09:30–11:00 would be lost.

A late start becomes a **backfill session**:
- It is stored with `backfill = true`. This needs a new boolean column, and the one-live index must exclude backfill rows.
- `liveSession()` ignores backfill sessions, so the running timer is not superseded and nothing shows as "current".
- Its own pause, resume, stop and interrupted events apply as they do today, using the same state machine and segments.
- Overlap with the running session is handled by the existing trimming. Whichever segment is turned into time entries first keeps the overlapping moments, and the other is trimmed and audited (`time.overlap_trimmed`).
- If the device never sends the stop, the existing heartbeat job interrupts the session at its last evidence, as it does for live sessions.

The migration is additive: one column with a default, and an index replaced. No existing data changes.

### 3.2 Late time is accepted and flagged, not rejected (Q7)

A start is **offline** when it happened more than 2 minutes before the batch's `sent_at`, after clock-skew correction. An offline start does not run the checks that only make sense for a timer starting now:

| Check | Live start (unchanged) | Offline start (proposed) |
|---|---|---|
| Daily or weekly limit | Refuse (`limit_reached`) | Accept. If the day it happened, or its week, ends up over the limit, flag it. |
| Project archived, inactive, or no longer assigned | Refuse | Accept on that project, and flag it. |
| Task archived | Refuse | Accept without the task, and flag it. |
| Tracking disabled for the member, or desktop tracking disabled by policy | Refuse | Refuse (decision 3) |

A flag is a `time.needs_review` event that names the reason and the time entries involved. It notifies the people who approve that member's timesheets. Approvers see it next to the existing late-time flag and can edit or delete the time with the usual history.

### 3.3 Mechanical fixes (no decision needed)

- **BE-4 and T10:** `webSwitch`, `webStop` and `forceStop` take the worker lock before reading the session.
- **T7:** discarding an idle period that was paused and then resumed removes only the paused span. Today it removes up to the first input, including work after Resume, and adds a second IDLE segment.
- **T9:** idle discard and screenshot deletion skip duration-only entries, whose clock times are placeholders.

## 4. Decisions

1. **Q6, running timer:** backfill sessions (3.1, recommended), or replace the start/stop events with a single "completed offline session" event from the desktop. The second option is a smaller server change, but it needs a desktop release and doesn't fix older desktops.
2. **Q7, limits and project checks on offline time:** accept and flag (3.2, recommended); check the limit against the day the session happened and still reject time over it; or accept only up to the limit and flag the rest as dropped.
3. **Offline time recorded while tracking was disabled** (for the member, or desktop tracking by policy): accept and flag (consistent with the rule), or keep rejecting (respects the setting, but loses the time).
4. **Duration-only manual time:** keep it out of overlap trimming (today's rule: its clock times are placeholders, so a day can count both it and tracked time), or flag the day for review when it has both.

## 5. Tests

- **Property tests** (`packages/api/test/offline-sync.property.test.ts`). These generate random interleavings of web start, stop and switch with desktop sessions synced late, in random batch splits, and check after each run that:
  - every second recorded by either source appears in exactly one live time entry (no loss, no double count);
  - a running timer is never ended by a late sync;
  - no event is `rejected` for limits or project state.
- **Regression tests:** the Q6 and Q7 reproductions from the audit.
- **E2E:** the Live page and Time entries after a late desktop sync while a web timer runs.
