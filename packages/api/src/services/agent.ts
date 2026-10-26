import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  activityMinutes,
  activityWindows,
  appSpans,
  deviceAuthCodes,
  deviceCredentials,
  devices,
  eodReports,
  ingestReceipts,
  memberships,
  organizations,
  policyAcks,
  screenshots,
  sessionTransitions,
  timeSegments,
  trackingSessions,
  urlSpans,
  users,
  withSystem,
  withTenant,
  type Tx,
} from '@tallywork/db';
import {
  DomainError,
  aggregateWindows,
  applyUrlPolicy,
  businessRule,
  forbidden,
  localDate,
  newId,
  notFound,
  windowStartOf,
  type SessionTrigger,
  type TrackingPolicy,
} from '@tallywork/domain';
import type { AgentBootstrapDto, AgentEvent, IngestBatchInput, IngestResponse, IngestResult, agentLoginInput, agentRegisterInput } from '@tallywork/contracts';
import type { z } from 'zod';
import type { Deps } from '../context';
import { pkceMatches, randomToken, sha256, signToken } from '../lib/crypto';
import { auditSystem, emit } from './events';
import { login } from './identity';
import { hasMfa, verifySecondFactor } from './mfa';
import { effectivePolicy, policyHash } from './policies';
import {
  applyTrigger,
  liveSession,
  lockWorker,
  recordIdleStarted,
  resolveIdle,
  startSession,
  todayAndWeek,
  workerTimezone,
  type ActorRef,
} from './tracking';
import { assignmentsFor } from './work';
import { loadActor, loadOrg } from '../middleware/tenant';
import type { Ctx } from './ctx';
import { requestManualTime, timesheetDue } from './timesheets';
import { assertBreakType, listBreakTypes, nextShift } from './operations';

const ACCESS_TTL_SECONDS = 10 * 60;
const REFRESH_TTL_DAYS = 30;
const MAX_FUTURE_SKEW_MS = 5_000;
const SERVER_INTERRUPT_CAUSE = 'heartbeat_lost';

// ─── Authorization (PKCE) ────────────────────────────────────────────────────
export async function createDeviceAuthCode(deps: Deps, userIdValue: string, organizationId: string, codeChallenge: string): Promise<string> {
  const membership = await withTenant(deps.db, organizationId, async (tx) => {
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, userIdValue), eq(memberships.organizationId, organizationId), eq(memberships.status, 'ACTIVE')));
    return m ?? null;
  });
  if (!membership) throw notFound('organization');
  const code = randomToken(32);
  await deps.db.insert(deviceAuthCodes).values({
    id: newId(),
    codeHash: sha256(code),
    codeChallenge,
    userId: userIdValue,
    organizationId,
    membershipId: membership.id,
    expiresAt: new Date(deps.now().getTime() + 10 * 60_000),
  });
  return code;
}

async function issueTokens(tx: Tx, deps: Deps, device: { id: string; organizationId: string; membershipId: string }, userIdValue: string, familyId = newId()) {
  const refresh = randomToken(40);
  await tx.insert(deviceCredentials).values({
    id: newId(),
    organizationId: device.organizationId,
    deviceId: device.id,
    familyId,
    refreshTokenHash: sha256(refresh),
    expiresAt: new Date(deps.now().getTime() + REFRESH_TTL_DAYS * 86400_000),
  });
  const access = signToken(deps.config.appSecret, 'device-access', { d: device.id, m: device.membershipId, o: device.organizationId, u: userIdValue }, ACCESS_TTL_SECONDS);
  return { access_token: access, refresh_token: refresh, expires_in: ACCESS_TTL_SECONDS, token_type: 'Bearer' as const };
}

export async function registerDevice(deps: Deps, input: z.infer<typeof agentRegisterInput>) {
  const [code] = await deps.db.select().from(deviceAuthCodes).where(and(eq(deviceAuthCodes.codeHash, sha256(input.code)), isNull(deviceAuthCodes.usedAt))).limit(1);
  if (!code || code.expiresAt < deps.now()) throw new DomainError('unauthenticated', 'invalid_code', 'The sign-in code is invalid or expired. Please sign in again.');
  if (!pkceMatches(input.code_verifier, code.codeChallenge)) throw new DomainError('unauthenticated', 'pkce_mismatch', 'Sign-in verification failed');
  await deps.db.update(deviceAuthCodes).set({ usedAt: deps.now() }).where(eq(deviceAuthCodes.id, code.id));
  return createDevice(deps, { organizationId: code.organizationId, membershipId: code.membershipId, userId: code.userId }, input.device);
}

async function createDevice(deps: Deps, owner: { organizationId: string; membershipId: string; userId: string }, device: z.infer<typeof agentRegisterInput>['device']) {
  return withTenant(deps.db, owner.organizationId, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, owner.organizationId));
    const deviceId = newId();
    const status = org?.settings.requireDeviceApproval ? 'PENDING' : 'ACTIVE';
    await tx.insert(devices).values({
      id: deviceId,
      organizationId: owner.organizationId,
      membershipId: owner.membershipId,
      name: device.name,
      platform: device.platform,
      osVersion: device.os_version ?? null,
      agentVersion: device.agent_version,
      capabilities: device.capabilities,
      publicKey: device.public_key ?? null,
      status,
      lastSeenAt: deps.now(),
    });
    await auditSystem(tx, owner.organizationId, { action: 'device.registered', actorType: 'user', actorId: owner.membershipId, targetType: 'device', targetId: deviceId, after: { name: device.name, platform: device.platform, status } });
    await emit(tx, owner.organizationId, 'device.registered', { device_id: deviceId, membership_id: owner.membershipId, status }, { workerId: owner.membershipId, deviceId });
    const tokens = await issueTokens(tx, deps, { id: deviceId, organizationId: owner.organizationId, membershipId: owner.membershipId }, owner.userId);
    return { device_id: deviceId, organization_id: owner.organizationId, status, ...tokens };
  });
}

/**
 * Desktop sign-in with email + password. Uses the web login checks (lockout, email verification),
 * then asks for the 2FA code and, for people in several organizations, which one this device is for.
 */
export async function loginDevice(deps: Deps, input: z.infer<typeof agentLoginInput>) {
  const { userId: uid } = await login(deps, input.email, input.password);
  if (await hasMfa(deps, uid)) {
    if (!input.mfa_code) throw new DomainError('unauthenticated', 'mfa_required', 'Enter the 6-digit code from your authenticator app');
    await verifySecondFactor(deps, uid, input.mfa_code);
  }
  const orgs = await withSystem(deps.db, (tx) =>
    tx
      .select({ membershipId: memberships.id, organizationId: organizations.id, name: organizations.name })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.userId, uid), eq(memberships.status, 'ACTIVE'))),
  );
  if (!orgs.length) throw new DomainError('forbidden', 'no_organization', 'This account is not part of any organization yet');
  const chosen = input.organization_id ? orgs.find((o) => o.organizationId === input.organization_id) : orgs.length === 1 ? orgs[0] : undefined;
  if (!chosen) {
    if (input.organization_id) throw notFound('organization');
    return { organization_required: true as const, organizations: orgs.map((o) => ({ id: o.organizationId, name: o.name })) };
  }
  return createDevice(deps, { organizationId: chosen.organizationId, membershipId: chosen.membershipId, userId: uid }, input.device);
}

/** Rotate a refresh token. Reuse of an already-used token revokes the whole family. */
export async function refreshDeviceToken(deps: Deps, refreshToken: string) {
  const invalid = new DomainError('unauthenticated', 'invalid_refresh_token', 'Please sign in again');
  const result = await withSystem(deps.db, async (tx) => {
    const [cred] = await tx.select().from(deviceCredentials).where(eq(deviceCredentials.refreshTokenHash, sha256(refreshToken))).limit(1);
    if (!cred || cred.revokedAt || cred.expiresAt < deps.now()) return null;
    if (cred.usedAt) {
      // Reuse of a rotated token = likely theft: revoke the whole family (committed, then reject).
      await tx.update(deviceCredentials).set({ revokedAt: deps.now() }).where(eq(deviceCredentials.familyId, cred.familyId));
      await auditSystem(tx, cred.organizationId, { action: 'device.token_reuse_detected', targetType: 'device', targetId: cred.deviceId });
      return null;
    }
    const [device] = await tx.select().from(devices).where(eq(devices.id, cred.deviceId));
    if (!device || device.status === 'REVOKED') throw new DomainError('unauthenticated', 'device_revoked', 'This device has been revoked by an administrator');
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, device.membershipId));
    if (!m || m.status !== 'ACTIVE') throw forbidden('Your membership is not active');
    await tx.update(deviceCredentials).set({ usedAt: deps.now() }).where(eq(deviceCredentials.id, cred.id));
    return issueTokens(tx, deps, device, m.userId, cred.familyId);
  });
  if (!result) throw invalid;
  return result;
}

// ─── Agent context ───────────────────────────────────────────────────────────
export interface AgentCtx {
  tx: Tx;
  deps: Deps;
  organizationId: string;
  orgTimezone: string;
  weekStart: number;
  membershipId: string;
  deviceId: string;
  userId: string;
  policy: TrackingPolicy;
}

export async function loadAgentCtx(tx: Tx, deps: Deps, p: { deviceId: string; membershipId: string; organizationId: string; userId: string }): Promise<AgentCtx> {
  const [device] = await tx.select().from(devices).where(eq(devices.id, p.deviceId));
  if (!device || device.membershipId !== p.membershipId) throw new DomainError('unauthenticated', 'device_unknown', 'Unknown device');
  if (device.status === 'REVOKED') throw new DomainError('unauthenticated', 'device_revoked', 'This device has been revoked by an administrator');
  const [m] = await tx.select().from(memberships).where(eq(memberships.id, p.membershipId));
  if (!m || m.status !== 'ACTIVE') throw forbidden('Your membership is not active');
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, p.organizationId));
  const policy = await effectivePolicy(tx, p.organizationId, p.membershipId);
  return { tx, deps, organizationId: p.organizationId, orgTimezone: org!.timezone, weekStart: org!.weekStart, membershipId: p.membershipId, deviceId: p.deviceId, userId: p.userId, policy };
}

/** The device's worker as a regular tenant actor, for reusing member-facing services with the same rules. */
export async function memberCtx(a: AgentCtx): Promise<Ctx> {
  const principal = { type: 'agent' as const, deviceId: a.deviceId, membershipId: a.membershipId, organizationId: a.organizationId, userId: a.userId };
  return {
    tx: a.tx,
    deps: a.deps,
    actor: await loadActor(a.tx, principal, a.organizationId, a.membershipId),
    org: await loadOrg(a.tx, a.organizationId),
    requestId: 'agent',
    ip: null,
    userAgent: null,
    policyCache: new Map([[a.membershipId, a.policy]]),
  };
}

function agentActor(a: AgentCtx): ActorRef {
  return { type: 'agent', id: a.deviceId };
}

export async function bootstrap(a: AgentCtx): Promise<AgentBootstrapDto> {
  const { tx } = a;
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, a.organizationId));
  const [u] = await tx.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, a.userId));
  const [device] = await tx.select().from(devices).where(eq(devices.id, a.deviceId));
  const tz = await workerTimezone(tx, a.membershipId, a.orgTimezone);
  const hash = policyHash(a.policy);
  const [ack] = await tx.select().from(policyAcks).where(and(eq(policyAcks.membershipId, a.membershipId), eq(policyAcks.policyHash, hash))).limit(1);
  const live = await liveSession(tx, a.membershipId);
  const now = a.deps.now();
  // Finished time only: the desktop app adds its running segment (now − segment start) to these itself.
  const tw = await todayAndWeek(tx, a.membershipId, tz, a.weekStart, now, false);
  return {
    organization: { id: org!.id, name: org!.name, timezone: org!.timezone },
    worker: { membership_id: a.membershipId, name: u?.name ?? '', email: u?.email ?? '', timezone: tz },
    device: { id: a.deviceId, status: device!.status },
    policy: a.policy,
    policy_hash: hash,
    policy_acknowledged: !!ack,
    assignments: (await assignmentsFor({ tx }, a.organizationId, a.membershipId)).map(({ billable_default: _b, ...p }) => p),
    current_session: live ? { id: live.id, state: live.state, project_id: live.projectId, task_id: live.taskId, started_at: live.startedAt.toISOString() } : null,
    today_seconds: tw.today,
    week_seconds: tw.week,
    timesheet_due: await timesheetDue(await memberCtx(a), a.membershipId, localDate(now, tz)),
    next_shift: await nextShift(tx, a.membershipId, tz, now),
    break_types: await listBreakTypes({ tx }),
    server_time: now.toISOString(),
    min_agent_version: a.deps.config.minAgentVersion,
  };
}

export async function acknowledgePolicy(a: AgentCtx, hash: string): Promise<void> {
  if (hash !== policyHash(a.policy)) throw businessRule('policy_changed', 'The policy changed; please review it again');
  await a.tx.insert(policyAcks).values({ id: newId(), organizationId: a.organizationId, membershipId: a.membershipId, policyHash: hash, deviceId: a.deviceId });
  await auditSystem(a.tx, a.organizationId, { action: 'policy.acknowledged', actorType: 'agent', actorId: a.deviceId, targetType: 'membership', targetId: a.membershipId, metadata: { hash } });
}

// ─── Ingest ──────────────────────────────────────────────────────────────────
class Duplicate extends Error {}

async function sessionFor(a: AgentCtx, sessionId: string) {
  const [s] = await a.tx.select().from(trackingSessions).where(eq(trackingSessions.id, sessionId)).limit(1);
  if (!s || s.membershipId !== a.membershipId) throw notFound('session');
  return s;
}

/**
 * If the server marked the session INTERRUPTED because heartbeats stopped (e.g. the
 * device was offline) and the same device now delivers events, the agent has proven
 * it kept tracking: recover with no gap (from the time the work segment was closed).
 */
async function recoverFromServerInterrupt(a: AgentCtx, s: typeof trackingSessions.$inferSelect, eventAt: Date) {
  if (s.state !== 'INTERRUPTED' || s.deviceId !== a.deviceId) return s;
  const [last] = await a.tx.select().from(sessionTransitions).where(eq(sessionTransitions.sessionId, s.id)).orderBy(desc(sessionTransitions.occurredAt), desc(sessionTransitions.createdAt)).limit(1);
  if (last?.cause !== SERVER_INTERRUPT_CAUSE) return s;
  const maxOfflineMs = a.policy.tracking.maxOfflineHours * 3600_000;
  if (eventAt.getTime() - last.occurredAt.getTime() > maxOfflineMs) return s;
  return applyTrigger(a.tx, s, 'RECOVER', { at: eventAt, openAt: last.occurredAt, actor: agentActor(a), cause: 'offline_sync' });
}

async function recomputeWindows(a: AgentCtx, session: typeof trackingSessions.$inferSelect, windowStarts: Date[]) {
  const unique = [...new Map(windowStarts.map((w) => [w.getTime(), w])).values()];
  for (const ws of unique) {
    const we = new Date(ws.getTime() + 10 * 60_000);
    const mins = await a.tx
      .select()
      .from(activityMinutes)
      .where(and(eq(activityMinutes.membershipId, a.membershipId), gte(activityMinutes.minuteStart, ws), lt(activityMinutes.minuteStart, we)));
    const [agg] = aggregateWindows(
      mins.map((m) => ({ minuteStart: m.minuteStart, keyboardCount: m.keyboardCount, mouseCount: m.mouseCount, activeSeconds: m.activeSeconds, trackedSeconds: m.trackedSeconds })),
    );
    if (!agg) continue;
    const values = {
      organizationId: a.organizationId,
      membershipId: a.membershipId,
      windowStart: ws,
      sessionId: session.id,
      projectId: session.projectId,
      taskId: session.taskId,
      activeSeconds: agg.activeSeconds,
      trackedSeconds: agg.trackedSeconds,
      keyboardCount: agg.keyboardCount,
      mouseCount: agg.mouseCount,
      activityPct: agg.activityPct,
      keyboardPct: agg.keyboardPct,
      mousePct: agg.mousePct,
      localDate: localDate(ws, session.timezone),
    };
    await a.tx
      .insert(activityWindows)
      .values(values)
      .onConflictDoUpdate({ target: [activityWindows.membershipId, activityWindows.windowStart], set: { ...values, updatedAt: new Date() } });
  }
}

/** Keep the end-of-day report written when clocking out (once per session; a resend changes nothing). */
async function saveEodReport(a: AgentCtx, s: typeof trackingSessions.$inferSelect, report: { text: string; finished: boolean }, at: Date) {
  const [row] = await a.tx
    .insert(eodReports)
    .values({ id: newId(), organizationId: a.organizationId, membershipId: a.membershipId, sessionId: s.id, projectId: s.projectId, taskId: s.taskId, localDate: localDate(at, s.timezone), body: report.text, finished: report.finished })
    .onConflictDoNothing()
    .returning({ id: eodReports.id });
  if (row) await emit(a.tx, a.organizationId, 'eod_report.submitted', { report_id: row.id, membership_id: a.membershipId, session_id: s.id, finished: report.finished }, { workerId: a.membershipId, sessionId: s.id, actor: agentActor(a) });
}

const TRIGGERS: Record<string, SessionTrigger> = {
  'session.pause': 'PAUSE',
  'session.resume': 'RESUME',
  'session.stop': 'STOP',
  'session.interrupted': 'INTERRUPT',
  'session.recover': 'RECOVER',
};

async function processEvent(a: AgentCtx, ev: AgentEvent, correct: (iso: string) => Date): Promise<void> {
  const at = correct(ev.occurred_at);
  const actor = agentActor(a);
  switch (ev.type) {
    case 'session.start': {
      const r = await startSession(a.tx, {
        organizationId: a.organizationId,
        orgTimezone: a.orgTimezone,
        orgWeekStart: a.weekStart,
        membershipId: a.membershipId,
        projectId: ev.project_id,
        taskId: ev.task_id ?? null,
        source: 'DESKTOP',
        deviceId: a.deviceId,
        sessionId: ev.session_id,
        at,
        note: ev.note ?? null,
        seq: ev.seq,
        actor,
        policy: a.policy,
        now: a.deps.now(),
      });
      if (r.duplicate) throw new Duplicate();
      return;
    }
    case 'session.pause':
    case 'session.resume':
    case 'session.stop':
    case 'session.interrupted':
    case 'session.recover': {
      await lockWorker(a.tx, a.membershipId);
      let s = await sessionFor(a, ev.session_id);
      if (ev.seq <= s.lastSeq) throw new Duplicate();
      if (ev.type !== 'session.interrupted') s = await recoverFromServerInterrupt(a, s, at);
      if (s.state === 'STOPPED') {
        await a.tx.update(trackingSessions).set({ lastSeq: Math.max(s.lastSeq, ev.seq) }).where(eq(trackingSessions.id, s.id));
        // Stopped already (an admin, a limit): the worker's report still counts. (A Duplicate would roll it back.)
        if (ev.type === 'session.stop' && ev.report) return saveEodReport(a, s, ev.report, at);
        if (ev.type === 'session.stop') throw new Duplicate();
        throw businessRule('session_stopped', `Session was already stopped (${s.endReason ?? 'unknown'})`);
      }
      const trigger = TRIGGERS[ev.type]!;
      const evidenceAt = ev.type === 'session.interrupted' ? correct(ev.last_evidence_at) : at;
      await applyTrigger(a.tx, s, trigger, {
        at: evidenceAt,
        actor,
        seq: ev.seq,
        cause: ev.type === 'session.interrupted' ? ev.cause : undefined,
        // Only an idle pause is idle time; a manual pause is a break (as on the web).
        pauseKind: ev.type === 'session.pause' && ev.kind === 'IDLE' ? 'IDLE' : 'BREAK',
        breakTypeId: ev.type === 'session.pause' && ev.kind !== 'IDLE' ? await assertBreakType(a.tx, ev.break_type_id) : null,
      });
      if (ev.type === 'session.stop' && ev.report) await saveEodReport(a, s, ev.report, at);
      return;
    }
    case 'session.note': {
      const s = await sessionFor(a, ev.session_id);
      await a.tx.update(trackingSessions).set({ note: ev.note, updatedAt: new Date() }).where(eq(trackingSessions.id, s.id));
      return;
    }
    case 'activity.minutes': {
      if (!a.policy.activity.enabled) throw businessRule('activity_disabled', 'Activity tracking is disabled by policy');
      let s = await sessionFor(a, ev.session_id);
      s = await recoverFromServerInterrupt(a, s, at);
      const rows = ev.minutes.map((m) => ({
        organizationId: a.organizationId,
        sessionId: s.id,
        membershipId: a.membershipId,
        minuteStart: new Date(Math.floor(correct(m.minute_start).getTime() / 60_000) * 60_000),
        keyboardCount: m.keyboard,
        mouseCount: m.mouse,
        activeSeconds: Math.min(m.active_seconds, m.tracked_seconds),
        trackedSeconds: m.tracked_seconds,
      }));
      await a.tx.insert(activityMinutes).values(rows).onConflictDoNothing();
      const latest = rows.reduce((mx, r) => (r.minuteStart > mx ? r.minuteStart : mx), rows[0]!.minuteStart);
      const evidence = new Date(latest.getTime() + 60_000);
      if (!s.lastEvidenceAt || evidence > s.lastEvidenceAt) await a.tx.update(trackingSessions).set({ lastEvidenceAt: evidence }).where(eq(trackingSessions.id, s.id));
      await recomputeWindows(a, s, rows.map((r) => windowStartOf(r.minuteStart)));
      return;
    }
    case 'idle.started': {
      if (!a.policy.idle.enabled) return;
      const s = await sessionFor(a, ev.session_id);
      await lockWorker(a.tx, a.membershipId);
      await recordIdleStarted(a.tx, s, { idleId: ev.idle_id, startedAt: correct(ev.started_at), policy: a.policy, actor });
      return;
    }
    case 'idle.resolved': {
      await sessionFor(a, ev.session_id);
      await resolveIdle(a.tx, {
        organizationId: a.organizationId,
        idleId: ev.idle_id,
        sessionId: ev.session_id,
        startedAt: correct(ev.started_at),
        endedAt: correct(ev.ended_at),
        resolution: ev.resolution,
        projectId: ev.project_id ?? null,
        taskId: ev.task_id ?? null,
        actor,
        resolvedBy: a.membershipId,
      });
      return;
    }
    case 'app.spans': {
      if (!a.policy.apps.enabled) throw businessRule('apps_disabled', 'Application tracking is disabled by policy');
      const s = await sessionFor(a, ev.session_id);
      await a.tx
        .insert(appSpans)
        .values(
          ev.spans.map((sp) => {
            const st = correct(sp.started_at);
            const en = correct(sp.ended_at);
            return { id: newId(), organizationId: a.organizationId, sessionId: s.id, membershipId: a.membershipId, deviceId: a.deviceId, clientSpanId: sp.span_id, appName: sp.app_name, appId: sp.app_id ?? null, startedAt: st, endedAt: en, durationSeconds: Math.max(0, Math.round((en.getTime() - st.getTime()) / 1000)) };
          }),
        )
        .onConflictDoNothing();
      await emit(a.tx, a.organizationId, 'usage.recorded', { membership_id: a.membershipId, dates: [localDate(at, s.timezone)] }, { workerId: a.membershipId, actor });
      return;
    }
    case 'url.spans': {
      if (!a.policy.urls.enabled) throw businessRule('urls_disabled', 'URL tracking is disabled by policy');
      const s = await sessionFor(a, ev.session_id);
      const rows = ev.spans
        .map((sp) => {
          // Re-apply policy server-side (defence in depth): domain-only and exclusions.
          const trimmed = applyUrlPolicy(sp.url ?? `https://${sp.domain}/`, a.policy.urls);
          if (!trimmed) return null;
          const st = correct(sp.started_at);
          const en = correct(sp.ended_at);
          return { id: newId(), organizationId: a.organizationId, sessionId: s.id, membershipId: a.membershipId, deviceId: a.deviceId, clientSpanId: sp.span_id, domain: trimmed.domain, url: trimmed.url, browser: sp.browser ?? null, startedAt: st, endedAt: en, durationSeconds: Math.max(0, Math.round((en.getTime() - st.getTime()) / 1000)) };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (rows.length) await a.tx.insert(urlSpans).values(rows).onConflictDoNothing();
      await emit(a.tx, a.organizationId, 'usage.recorded', { membership_id: a.membershipId, dates: [localDate(at, s.timezone)] }, { workerId: a.membershipId, actor });
      return;
    }
    case 'screenshot.captured': {
      if (!a.policy.screenshots.enabled) throw businessRule('screenshots_disabled', 'Screenshots are disabled by policy');
      const s = await sessionFor(a, ev.session_id);
      const expectedPrefix = screenshotKeyPrefix(a.organizationId, a.membershipId);
      if (!ev.storage_key.startsWith(expectedPrefix)) throw forbidden('Invalid screenshot storage key');
      const capturedAt = correct(ev.captured_at);
      await a.tx
        .insert(screenshots)
        .values({
          id: ev.screenshot_id,
          organizationId: a.organizationId,
          sessionId: s.id,
          membershipId: a.membershipId,
          deviceId: a.deviceId,
          capturedAt,
          displayIndex: ev.display_index,
          storageKey: ev.storage_key,
          width: ev.width,
          height: ev.height,
          bytes: ev.bytes,
          sha256: ev.sha256,
          blurred: ev.blurred,
          status: 'READY',
          windowStart: windowStartOf(capturedAt),
        })
        .onConflictDoNothing();
      await emit(a.tx, a.organizationId, 'screenshot.captured', { screenshot_id: ev.screenshot_id, session_id: s.id }, { workerId: a.membershipId, sessionId: s.id, actor });
      return;
    }
    case 'manual_time.request': {
      // Same rules as the web: policy, reason, overlap, locked periods, approval.
      await requestManualTime(await memberCtx(a), { project_id: ev.project_id, task_id: ev.task_id ?? null, started_at: ev.started_at, ended_at: ev.ended_at, reason: ev.reason, note: ev.note }, { id: ev.event_id });
      return;
    }
  }
}

export function screenshotKeyPrefix(organizationId: string, membershipId: string): string {
  return `org/${organizationId}/screenshots/${membershipId}/`;
}

export async function ingestBatch(a: AgentCtx, batch: IngestBatchInput): Promise<IngestResponse> {
  const now = a.deps.now();
  const sentAt = new Date(batch.sent_at);
  // Positive skew = device clock is behind the server.
  const rawSkew = now.getTime() - sentAt.getTime();
  const skew = Math.abs(rawSkew) < 2_000 ? 0 : rawSkew;
  const correct = (iso: string) => {
    const t = new Date(new Date(iso).getTime() + skew);
    return t.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS ? now : t;
  };

  const results: IngestResult[] = [];
  for (const ev of batch.events) {
    const inserted = await a.tx
      .insert(ingestReceipts)
      .values({ organizationId: a.organizationId, deviceId: a.deviceId, clientEventId: ev.event_id, eventType: ev.type, status: 'accepted' })
      .onConflictDoNothing()
      .returning({ id: ingestReceipts.clientEventId });
    if (!inserted.length) {
      results.push({ event_id: ev.event_id, status: 'duplicate' });
      continue;
    }
    try {
      // Savepoint per event: one bad event never aborts the batch.
      await a.tx.transaction(async (sp) => processEvent({ ...a, tx: sp }, ev, correct));
      results.push({ event_id: ev.event_id, status: 'accepted' });
    } catch (e) {
      if (e instanceof Duplicate) {
        results.push({ event_id: ev.event_id, status: 'duplicate' });
        continue;
      }
      if (!(e instanceof DomainError)) throw e;
      await a.tx.update(ingestReceipts).set({ status: 'rejected', reason: e.code }).where(and(eq(ingestReceipts.deviceId, a.deviceId), eq(ingestReceipts.clientEventId, ev.event_id)));
      results.push({ event_id: ev.event_id, status: 'rejected', code: e.code, message: e.message });
    }
  }

  await a.tx.update(devices).set({ lastSyncAt: now, lastSeenAt: now, clockSkewMs: Math.max(-2_000_000_000, Math.min(2_000_000_000, rawSkew)), status: sql`case when ${devices.status} = 'OFFLINE' then 'ACTIVE' else ${devices.status} end` }).where(eq(devices.id, a.deviceId));
  const live = await liveSession(a.tx, a.membershipId);
  return {
    results,
    server_time: now.toISOString(),
    clock_skew_ms: rawSkew,
    session: live ? { id: live.id, state: live.state, project_id: live.projectId, task_id: live.taskId, started_at: live.startedAt.toISOString(), end_reason: live.endReason } : null,
    policy_hash: policyHash(a.policy),
  };
}

export async function heartbeat(a: AgentCtx, input: { sessionId?: string | null; agentVersion?: string; capabilities?: Record<string, boolean | string> }) {
  const now = a.deps.now();
  await a.tx
    .update(devices)
    .set({
      lastSeenAt: now,
      ...(input.agentVersion ? { agentVersion: input.agentVersion } : {}),
      ...(input.capabilities ? { capabilities: input.capabilities } : {}),
      status: sql`case when ${devices.status} = 'OFFLINE' then 'ACTIVE' else ${devices.status} end`,
    })
    .where(eq(devices.id, a.deviceId));
  let live = await liveSession(a.tx, a.membershipId);
  if (live && live.deviceId === a.deviceId) {
    if (live.state === 'INTERRUPTED') live = await recoverFromServerInterrupt(a, live, now);
    await a.tx.update(trackingSessions).set({ lastHeartbeatAt: now }).where(eq(trackingSessions.id, live.id));
  }
  return {
    server_time: now.toISOString(),
    session: live ? { id: live.id, state: live.state, project_id: live.projectId, task_id: live.taskId, started_at: live.startedAt.toISOString(), end_reason: live.endReason } : null,
    policy_hash: policyHash(a.policy),
  };
}

export async function workOpenSegmentStart(tx: Tx, sessionId: string): Promise<Date | null> {
  const [open] = await tx.select().from(timeSegments).where(and(eq(timeSegments.sessionId, sessionId), isNull(timeSegments.endedAt), eq(timeSegments.kind, 'WORK')));
  return open?.startedAt ?? null;
}

