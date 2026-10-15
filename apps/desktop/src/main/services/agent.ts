import { Notification, net, powerMonitor } from 'electron';
import { EventEmitter } from 'node:events';
import { put } from '@vercel/blob/client';
import { newId, type TrackingPolicy } from '@tallywork/domain';
import type { AgentState, Assignment, IpcPayload, ManualRequest } from '../../shared/ipc';
import { AgentApi, ApiError } from './api';
import { signIn, signInWithPassword, type PasswordCredentials, type PasswordSignInResult } from './auth';
import { manualRequestError, reminderKey } from './manual';
import { limitAction, shiftReminder } from './reminders';
import { ActivityMonitor, AppTracker, captureScreens, isWaylandSession, msUntilNextShotSlot, nextShotDelays } from './monitors';
import { OfflineQueue, queueFileFor, type QueuedEvent } from './queue';
import { SecureStore } from './secure-store';
import { BROWSER_NAMES, UrlResolver } from './urls';

const SYNC_INTERVAL_MS = 10_000;
const HEARTBEAT_MS = 60_000;
const BOOTSTRAP_MS = 5 * 60_000;
const IDLE_POLL_MS = 5_000;
const FLUSH_MS = 60_000;
const REMINDER_MS = 30_000;

/** PUT one object to a Supabase Storage signed upload URL (the URL itself is the credential). */
async function uploadToSignedUrl(url: string, data: Buffer, contentType: string): Promise<void> {
  const res = await net.fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType, 'x-upsert': 'true' }, body: new Uint8Array(data) });
  if (!res.ok) throw new ApiError(res.status, 'upload_failed', `Screenshot upload failed (${res.status})`);
}

interface LocalSession {
  id: string;
  projectId: string;
  taskId: string | null;
  startedAt: string;
  seq: number;
  state: 'active' | 'paused';
  baseSeconds: number;
  segmentStartedAt: string | null;
  lastEvidenceAt: string;
  note: string;
}

interface Bootstrap {
  organization: { id: string; name: string; timezone: string };
  worker: { membership_id: string; name: string; email: string; timezone: string };
  device: { id: string; status: string };
  policy: TrackingPolicy;
  policy_hash: string;
  assignments: Assignment[];
  current_session: { id: string; state: string; project_id: string; task_id: string | null; started_at: string } | null;
  today_seconds: number;
  week_seconds: number;
  timesheet_due: { period_start: string; period_end: string; status: 'DRAFT' | 'REJECTED'; total_seconds: number; overdue: boolean } | null;
  next_shift: { starts_at: string; ends_at: string } | null;
  break_types: Array<{ id: string; name: string; paid: boolean; max_minutes: number | null }>;
}

/** Who a bootstrap belongs to: queued events are only sent with this account's credentials. */
function accountOf(b: Bootstrap): string {
  return `${b.organization.id}:${b.worker.membership_id}`;
}

/**
 * The agent core. Owns local tracking state (a mirror of the server state
 * machine), monitors, the offline queue and synchronization. The server is
 * authoritative: after every sync the local state is reconciled with it.
 */
export class Agent extends EventEmitter {
  readonly store = new SecureStore();
  readonly api = new AgentApi(this.store);
  /** The account (organization:member) whose queue, session and requests are on this machine. */
  private account: string | null = this.store.readJson<string>('account');
  /** The signed-in account's offline queue; replaced when another account signs in. */
  queue = new OfflineQueue(this.store, queueFileFor(this.account));
  readonly activity = new ActivityMonitor();
  /** Active-tab URLs on Windows: browser extension bridge, falling back to the address bar. */
  readonly urls = new UrlResolver(() => ({
    tracking: this.session?.state === 'active',
    urlsEnabled: !!this.boot?.policy.urls.enabled,
    mode: this.boot?.policy.urls.mode ?? 'domain',
  }));
  readonly apps = new AppTracker(() => this.boot?.policy ?? null, this.urls);
  private boot: Bootstrap | null = null;
  private session: LocalSession | null;
  private idle: { idleId: string; startedAt: number; endedAt: number | null } | null = null;
  private recovery: AgentState['recoveryPrompt'] = null;
  private timers: NodeJS.Timeout[] = [];
  private shotTimers: NodeJS.Timeout[] = [];
  private syncing = false;
  private lastSyncAt: string | null = null;
  private online = true;
  private syncError: string | null = null;
  private phase: AgentState['phase'];
  private error: string | null = null;
  private lastProject: AgentState['lastProject'];
  private todayBase = { seconds: 0, at: Date.now() };
  private weekBase = { seconds: 0, at: Date.now() };
  private manualRequests: ManualRequest[];
  private breakTypeId: string | null = null;

  constructor(
    private serverUrl: string,
    private readonly version: string,
    /** set by device management: the only server this app may use */
    private readonly managedServer: string | null = null,
  ) {
    super();
    this.session = this.store.readJson<LocalSession>('session');
    this.lastProject = this.store.readJson<AgentState['lastProject']>('last-project');
    this.manualRequests = this.store.readJson<ManualRequest[]>('manual-requests') ?? [];
    this.phase = this.api.signedIn ? 'ready' : 'signed_out';
    if (this.api.serverUrl) this.serverUrl = this.api.serverUrl;
    if (this.managedServer) this.serverUrl = this.managedServer;
    if (this.managedServer) this.serverUrl = this.managedServer;
    this.api.onSignedOut = (reason) => {
      this.stopMonitors();
      this.phase = 'signed_out';
      this.error = reason;
      this.boot = null;
      this.emitState();
    };
  }

  async init(): Promise<void> {
    await this.activity.init();
    await this.apps.init();
    await this.urls.start();
    powerMonitor.on('suspend', () => this.onSuspend());
    powerMonitor.on('resume', () => this.emitState());
    powerMonitor.on('shutdown', () => this.onSuspend());
    if (this.session) this.handleCrashRecovery();
    this.timers.push(setInterval(() => void this.sync(), SYNC_INTERVAL_MS));
    this.timers.push(setInterval(() => void this.heartbeat(), HEARTBEAT_MS));
    this.timers.push(setInterval(() => void this.refreshBootstrap(), BOOTSTRAP_MS));
    this.timers.push(setInterval(() => this.checkIdle(), IDLE_POLL_MS));
    this.timers.push(setInterval(() => this.flushObservations(), FLUSH_MS));
    this.timers.push(setInterval(() => this.emitState(), 1_000));
    this.timers.push(setInterval(() => this.checkReminders(), REMINDER_MS));
    if (this.api.signedIn) await this.refreshBootstrap();
  }

  get capabilities(): Record<string, boolean> {
    return {
      input: this.activity.available,
      screenshots: !isWaylandSession(),
      apps: this.apps.available,
      urls: this.apps.urlsAvailable,
      // Reported so admins can see why a Linux worker has no activity, app or screenshot data.
      wayland: isWaylandSession(),
    };
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────
  async login(serverUrl?: string): Promise<void> {
    if (serverUrl && !this.managedServer) this.serverUrl = serverUrl.replace(/\/$/, '');
    this.phase = 'signing_in';
    this.error = null;
    this.emitState();
    try {
      await signIn(this.api, this.serverUrl, this.capabilities);
      this.phase = 'ready';
      await this.refreshBootstrap();
    } catch (e) {
      this.phase = 'signed_out';
      this.error = e instanceof Error ? e.message : 'Sign-in failed';
    }
    this.emitState();
  }

  /** Email + password sign-in. Returns the next step when the server needs a 2FA code or an organization choice. */
  async loginWithPassword(creds: PasswordCredentials & { serverUrl?: string }): Promise<PasswordSignInResult | { status: 'error' }> {
    if (creds.serverUrl && !this.managedServer) this.serverUrl = creds.serverUrl.replace(/\/$/, '');
    this.phase = 'signing_in';
    this.error = null;
    this.emitState();
    let result: PasswordSignInResult | { status: 'error' };
    try {
      result = await signInWithPassword(this.api, this.serverUrl, this.capabilities, creds);
      if (result.status === 'signed_in') {
        this.phase = 'ready';
        await this.refreshBootstrap();
      } else this.phase = 'signed_out';
    } catch (e) {
      this.phase = 'signed_out';
      this.error = e instanceof Error ? e.message : 'Sign-in failed';
      result = { status: 'error' };
    }
    this.emitState();
    return result;
  }

  /**
   * Signs out after stopping the timer and trying to send what is queued. Anything still unsent
   * (offline) stays in this account's own queue and is sent the next time it signs in here; it is
   * never sent with someone else's credentials.
   */
  async logout(): Promise<void> {
    if (this.session) await this.stop();
    await this.sync();
    this.api.clear();
    this.boot = null;
    this.phase = 'signed_out';
    this.emitState();
  }

  // ─── Tracking commands ─────────────────────────────────────────────────────
  private enqueue(e: Omit<QueuedEvent, 'event_id'>): void {
    this.queue.push({ event_id: newId(), ...e } as QueuedEvent);
  }

  private persistSession(): void {
    this.store.writeJson('session', this.session);
  }

  async start(projectId: string, taskId: string | null): Promise<void> {
    if (!this.boot) throw new Error('Not ready');
    if (!this.boot.policy.tracking.allowDesktop) throw new Error('Desktop tracking is disabled by your organization');
    if (this.queue.full) throw new Error('Offline storage is full. Reconnect to the internet to continue tracking.');
    const st = this.state();
    const lim = limitAction(this.boot.policy.limits, st.todaySeconds, st.weekSeconds, this.localToday(), null);
    if (lim?.action === 'stop') throw new Error(`You have reached your ${lim.kind} time limit`);
    if (this.session) await this.stop();
    const now = new Date().toISOString();
    this.session = { id: newId(), projectId, taskId, startedAt: now, seq: 1, state: 'active', baseSeconds: 0, segmentStartedAt: now, lastEvidenceAt: now, note: '' };
    this.persistSession();
    this.lastProject = { projectId, taskId };
    this.store.writeJson('last-project', this.lastProject);
    this.enqueue({ type: 'session.start', session_id: this.session.id, seq: 1, occurred_at: now, project_id: projectId, task_id: taskId });
    this.startMonitors();
    this.emitState();
    void this.sync();
  }

  async stop(at = new Date()): Promise<void> {
    const s = this.session;
    if (!s) return;
    this.flushObservations();
    this.stopMonitors();
    this.flushObservations();
    s.seq++;
    this.enqueue({ type: 'session.stop', session_id: s.id, seq: s.seq, occurred_at: at.toISOString() });
    this.addWorked(at);
    this.session = null;
    this.idle = null;
    this.persistSession();
    this.emitState();
    void this.sync();
  }

  private addWorked(at: Date): void {
    const s = this.session;
    if (s?.segmentStartedAt) {
      const secs = Math.max(0, (at.getTime() - Date.parse(s.segmentStartedAt)) / 1000);
      this.todayBase.seconds += secs;
      this.weekBase.seconds += secs;
    }
  }

  /** Take a break of one of the organization's break types (or an untyped break). */
  takeBreak(breakTypeId: string | null): void {
    if (breakTypeId && !this.boot?.break_types.some((b) => b.id === breakTypeId)) throw new Error('Unknown break type');
    this.pause('BREAK', new Date(), breakTypeId);
  }

  pause(kind: 'MANUAL' | 'BREAK' | 'IDLE' = 'MANUAL', at = new Date(), breakTypeId: string | null = null): void {
    const s = this.session;
    if (!s || s.state !== 'active') return;
    this.flushObservations();
    this.addWorked(at);
    s.baseSeconds += s.segmentStartedAt ? Math.max(0, (at.getTime() - Date.parse(s.segmentStartedAt)) / 1000) : 0;
    s.segmentStartedAt = null;
    s.state = 'paused';
    s.seq++;
    this.enqueue({ type: 'session.pause', session_id: s.id, seq: s.seq, occurred_at: at.toISOString(), kind, ...(breakTypeId ? { break_type_id: breakTypeId } : {}) });
    this.breakTypeId = kind === 'IDLE' ? null : breakTypeId;
    this.stopMonitors();
    this.persistSession();
    this.emitState();
  }

  resume(at = new Date()): void {
    const s = this.session;
    if (!s || s.state !== 'paused') return;
    s.state = 'active';
    s.segmentStartedAt = at.toISOString();
    s.seq++;
    this.breakTypeId = null;
    this.enqueue({ type: 'session.resume', session_id: s.id, seq: s.seq, occurred_at: at.toISOString() });
    this.startMonitors();
    this.persistSession();
    this.emitState();
  }

  setNote(note: string): void {
    if (!this.session) return;
    this.session.note = note;
    this.enqueue({ type: 'session.note', session_id: this.session.id, occurred_at: new Date().toISOString(), note });
    this.persistSession();
  }

  // ─── Manual time ───────────────────────────────────────────────────────────
  /** Queue a manual time request. It is saved on this computer first, so it works offline. */
  async requestManualTime(r: IpcPayload<'manualTime:request'>): Promise<void> {
    if (!this.boot) throw new Error('Not ready');
    const problem = manualRequestError(r, this.boot.policy, this.boot.assignments);
    if (problem) throw new Error(problem);
    if (this.queue.full) throw new Error('Offline storage is full. Reconnect to the internet first.');
    const id = newId();
    this.queue.push({
      event_id: id,
      type: 'manual_time.request',
      occurred_at: new Date().toISOString(),
      project_id: r.projectId,
      task_id: r.taskId,
      started_at: new Date(r.startedAt).toISOString(),
      ended_at: new Date(r.endedAt).toISOString(),
      ...(r.reason.trim() ? { reason: r.reason.trim() } : {}),
      ...(r.note ? { note: r.note } : {}),
    });
    this.manualRequests = [{ id, projectId: r.projectId, startedAt: r.startedAt, endedAt: r.endedAt, status: 'queued' as const, message: null }, ...this.manualRequests].slice(0, 10);
    this.store.writeJson('manual-requests', this.manualRequests);
    this.emitState();
    void this.sync();
  }

  /** Delivery results for queued manual requests; rejections (overlap, locked timesheet…) are shown to the worker. */
  private settleManualRequests(results: Array<{ event_id: string; status: string; message?: string }>): void {
    let changed = false;
    for (const r of results) {
      const m = this.manualRequests.find((x) => x.id === r.event_id);
      if (!m || m.status !== 'queued') continue;
      changed = true;
      if (r.status === 'rejected') {
        m.status = 'rejected';
        m.message = r.message ?? 'The request was not accepted';
        new Notification({ title: 'Manual time not added', body: m.message }).show();
      } else {
        m.status = 'sent';
      }
    }
    if (changed) {
      this.store.writeJson('manual-requests', this.manualRequests);
      this.emitState();
    }
  }

  private remindTimesheet(b: Bootstrap): void {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: b.worker.timezone });
    const key = reminderKey(b.timesheet_due, today);
    if (!key || this.store.readJson<string>('timesheet-reminded') === key) return;
    this.store.writeJson('timesheet-reminded', key);
    const due = b.timesheet_due!;
    const n = new Notification({
      title: due.overdue ? 'Timesheet not submitted' : 'Timesheet due today',
      body: `Your timesheet for ${due.period_start} – ${due.period_end} is ready to review and submit.`,
    });
    n.on('click', () => this.emit('open', 'timesheet'));
    n.show();
  }

  // ─── Reminders (shifts, limits) ────────────────────────────────────────────
  private localToday(): string {
    return new Date().toLocaleDateString('en-CA', this.boot ? { timeZone: this.boot.worker.timezone } : undefined);
  }

  private checkReminders(): void {
    const b = this.boot;
    if (!b) return;
    const st = this.state();
    const tracking = st.tracking.state !== 'stopped';
    const shiftKey = shiftReminder(b.next_shift, tracking, Date.now(), this.store.readJson<string>('shift-reminded'));
    if (shiftKey) {
      this.store.writeJson('shift-reminded', shiftKey);
      const at = new Date(b.next_shift!.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const n = new Notification({ title: `Your shift starts at ${at}`, body: 'Start the timer when you begin work.' });
      n.on('click', () => this.emit('show'));
      n.show();
    }
    if (st.tracking.state !== 'active') return;
    const lim = limitAction(b.policy.limits, st.todaySeconds, st.weekSeconds, this.localToday(), this.store.readJson<string>('limit-warned'));
    if (!lim) return;
    if (lim.action === 'warn') {
      this.store.writeJson('limit-warned', lim.key);
      new Notification({ title: `${Math.max(1, Math.round(lim.remainingSeconds / 60))} minutes left today`, body: `You are close to your ${lim.kind} time limit. The timer stops when it is reached.` }).show();
    } else {
      void this.stop();
      new Notification({ title: 'Tracking stopped: time limit reached', body: `You have reached your ${lim.kind} time limit.` }).show();
    }
  }

  // ─── Monitors ──────────────────────────────────────────────────────────────
  private startMonitors(): void {
    const p = this.boot?.policy;
    if (!p) return;
    // Unavailable input (Wayland, no macOS permission) records nothing rather than minutes at 0 %.
    if (p.activity.enabled && this.activity.available) this.activity.start();
    if (p.apps.enabled || p.urls.enabled) this.apps.start();
    this.scheduleScreenshots();
  }

  private stopMonitors(): void {
    this.activity.stop();
    this.apps.stop();
    for (const t of this.shotTimers) clearTimeout(t);
    this.shotTimers = [];
  }

  /** Move buffered activity minutes and app/url spans into the durable queue. */
  private flushObservations(): void {
    const s = this.session;
    const minutes = this.activity.drain();
    const { apps, urls } = this.apps.drain();
    if (!s) return;
    const now = new Date().toISOString();
    if (minutes.length) {
      this.enqueue({ type: 'activity.minutes', session_id: s.id, occurred_at: now, minutes });
      const last = minutes[minutes.length - 1]!;
      s.lastEvidenceAt = new Date(Date.parse(last.minute_start) + last.tracked_seconds * 1000).toISOString();
      this.persistSession();
    }
    if (apps.length) this.enqueue({ type: 'app.spans', session_id: s.id, occurred_at: now, spans: apps });
    if (urls.length) this.enqueue({ type: 'url.spans', session_id: s.id, occurred_at: now, spans: urls });
  }

  private scheduleScreenshots(): void {
    for (const t of this.shotTimers) clearTimeout(t);
    this.shotTimers = [];
    const p = this.boot?.policy.screenshots;
    if (!p?.enabled || !this.capabilities.screenshots) return;
    const now = Date.now();
    for (const d of nextShotDelays(p.perTenMinutes, now)) this.shotTimers.push(setTimeout(() => void this.takeScreenshots(), d));
    // Plan the next slot right after its boundary (the small margin keeps us inside it).
    this.shotTimers.push(setTimeout(() => this.session?.state === 'active' && this.scheduleScreenshots(), msUntilNextShotSlot(now) + 50));
  }

  private async takeScreenshots(): Promise<void> {
    const s = this.session;
    const p = this.boot?.policy.screenshots;
    if (!s || s.state !== 'active' || !p?.enabled) return;
    try {
      const shots = await captureScreens(p.blur);
      for (const shot of shots) {
        const intent = await this.api.request<{ storage_key: string; thumb_key: string; method: 'vercel-blob' | 'supabase' | 'api'; token: string; thumb_token: string; upload_url: string | null; thumb_upload_url: string | null }>('POST', '/agent/screenshots/upload-intent', {
          screenshot_id: shot.id,
          session_id: s.id,
          captured_at: shot.capturedAt,
          content_type: 'image/jpeg',
          bytes: shot.data.length,
        });
        if (intent.method === 'vercel-blob') {
          await put(intent.storage_key, shot.data, { access: 'private', token: intent.token, contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true } as never);
          await put(intent.thumb_key, shot.thumb, { access: 'private', token: intent.thumb_token, contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true } as never);
        } else if (intent.method === 'supabase') {
          await uploadToSignedUrl(intent.upload_url!, shot.data, 'image/jpeg');
          await uploadToSignedUrl(intent.thumb_upload_url!, shot.thumb, 'image/jpeg');
        } else {
          await this.api.request('PUT', intent.upload_url!.replace('/api/v1', ''), undefined, { data: shot.data, contentType: 'image/jpeg' });
          await this.api.request('PUT', intent.thumb_upload_url!.replace('/api/v1', ''), undefined, { data: shot.thumb, contentType: 'image/jpeg' });
        }
        this.enqueue({ type: 'screenshot.captured', session_id: s.id, occurred_at: shot.capturedAt, screenshot_id: shot.id, captured_at: shot.capturedAt, display_index: shot.displayIndex, blurred: shot.blurred, width: shot.width, height: shot.height, bytes: shot.data.length, sha256: shot.sha256, storage_key: intent.storage_key });
      }
      if (p.notify && shots.length) new Notification({ title: 'Screenshot taken', body: p.blur ? 'Blurred before upload.' : 'You can review it on the web.', silent: true }).show();
    } catch (e) {
      // Offline or capture denied: skip this capture (screenshots are best-effort, time is not).
      // Logged so a persistent failure (permissions, storage) is diagnosable.
      console.warn(`[screenshots] capture skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ─── Idle ──────────────────────────────────────────────────────────────────
  private checkIdle(): void {
    const s = this.session;
    const p = this.boot?.policy.idle;
    if (!s || !p?.enabled) return;
    const idleSec = powerMonitor.getSystemIdleTime();
    const threshold = p.thresholdMinutes * 60;
    if (!this.idle && s.state === 'active' && idleSec >= threshold) {
      const startedAt = Date.now() - idleSec * 1000;
      this.idle = { idleId: newId(), startedAt, endedAt: null };
      this.enqueue({ type: 'idle.started', session_id: s.id, occurred_at: new Date(startedAt).toISOString(), idle_id: this.idle.idleId, started_at: new Date(startedAt).toISOString() });
      if (p.behavior === 'pause') {
        // The server pauses the session; mirror it locally without a separate pause command.
        this.addWorked(new Date(startedAt));
        s.baseSeconds += s.segmentStartedAt ? Math.max(0, (startedAt - Date.parse(s.segmentStartedAt)) / 1000) : 0;
        s.segmentStartedAt = null;
        s.state = 'paused';
        this.stopMonitors();
        this.persistSession();
      }
      this.emitState();
    } else if (this.idle && this.idle.endedAt === null && idleSec < 5) {
      this.idle.endedAt = Date.now();
      if (p.behavior === 'keep') this.resolveIdle('KEPT');
      else {
        new Notification({ title: 'You were idle', body: `Idle for ${Math.round((this.idle.endedAt - this.idle.startedAt) / 60000)} minutes. Keep or discard that time?` }).show();
        this.emit('show');
      }
      this.emitState();
    }
  }

  resolveIdle(choice: 'KEPT' | 'DISCARDED' | 'REASSIGNED', projectId?: string, taskId?: string | null): void {
    const s = this.session;
    const i = this.idle;
    if (!s || !i) return;
    const endedAt = i.endedAt ?? Date.now();
    this.enqueue({
      type: 'idle.resolved',
      session_id: s.id,
      occurred_at: new Date(endedAt).toISOString(),
      idle_id: i.idleId,
      started_at: new Date(i.startedAt).toISOString(),
      ended_at: new Date(endedAt).toISOString(),
      resolution: choice,
      project_id: projectId ?? null,
      task_id: taskId ?? null,
    });
    const idleSecs = (endedAt - i.startedAt) / 1000;
    if (s.state === 'paused' && this.boot?.policy.idle.behavior === 'pause') {
      // Server resumes on resolution; KEPT counts the idle span as work.
      if (choice === 'KEPT') {
        s.baseSeconds += idleSecs;
        this.todayBase.seconds += idleSecs;
        this.weekBase.seconds += idleSecs;
      }
      s.state = 'active';
      s.segmentStartedAt = new Date(endedAt).toISOString();
      this.startMonitors();
    } else if (choice !== 'KEPT') {
      // Tracking continued while idle: subtract the discarded span locally.
      s.baseSeconds -= Math.min(idleSecs, s.baseSeconds + (s.segmentStartedAt ? (Date.now() - Date.parse(s.segmentStartedAt)) / 1000 : 0));
      this.todayBase.seconds -= idleSecs;
      this.weekBase.seconds -= idleSecs;
    }
    this.idle = null;
    this.persistSession();
    this.emitState();
    void this.sync();
  }

  // ─── Power & crash recovery ────────────────────────────────────────────────
  private onSuspend(): void {
    const s = this.session;
    if (!s) return;
    // Stop at the last moment we had evidence of work; sleeping time is never tracked.
    const at = s.state === 'active' ? new Date(Math.max(Date.parse(s.lastEvidenceAt), Date.now() - 60_000)) : new Date();
    void this.stop(at);
    new Notification({ title: 'Tracking stopped', body: 'Your computer went to sleep. Start the timer again when you are back.' }).show();
  }

  private handleCrashRecovery(): void {
    const s = this.session!;
    s.seq++;
    this.enqueue({ type: 'session.interrupted', session_id: s.id, seq: s.seq, occurred_at: new Date().toISOString(), last_evidence_at: s.lastEvidenceAt, cause: 'crash' });
    this.recovery = { sessionId: s.id, lastEvidenceAt: s.lastEvidenceAt, projectName: '' };
    this.persistSession();
  }

  resolveRecovery(resume: boolean): void {
    const s = this.session;
    this.recovery = null;
    if (!s) return this.emitState();
    s.seq++;
    const now = new Date().toISOString();
    if (resume) {
      this.enqueue({ type: 'session.recover', session_id: s.id, seq: s.seq, occurred_at: now });
      s.state = 'active';
      s.segmentStartedAt = now;
      this.startMonitors();
      this.persistSession();
    } else {
      this.enqueue({ type: 'session.stop', session_id: s.id, seq: s.seq, occurred_at: now });
      this.session = null;
      this.persistSession();
    }
    this.emitState();
    void this.sync();
  }

  // ─── Sync ──────────────────────────────────────────────────────────────────
  async sync(): Promise<void> {
    if (this.syncing || !this.api.signedIn) return;
    // Only with the credentials of the account that recorded the events (known from bootstrap).
    if (!this.boot) await this.refreshBootstrap();
    if (!this.boot || accountOf(this.boot) !== this.account) return;
    this.syncing = true;
    try {
      while (this.queue.size > 0) {
        const batch = this.queue.peek(200);
        const res = await this.api.request<{ results: Array<{ event_id: string; status: string; code?: string; message?: string }>; session: { id: string; state: string; end_reason: string | null } | null; policy_hash: string }>('POST', '/agent/ingest/batch', { sent_at: new Date().toISOString(), events: batch });
        this.queue.ack(res.results.map((r) => r.event_id));
        this.settleManualRequests(res.results);
        const rejected = res.results.filter((r) => r.status === 'rejected');
        this.syncError = rejected.length ? (rejected[0]!.message ?? 'Some data was rejected') : null;
        if (rejected.some((r) => r.code === 'limit_reached' || r.code === 'session_already_running')) this.reconcile(res.session);
        if (this.boot && res.policy_hash !== this.boot.policy_hash) void this.refreshBootstrap();
        if (res.results.length < batch.length) break;
      }
      this.online = true;
      this.lastSyncAt = new Date().toISOString();
    } catch (e) {
      this.online = !(e instanceof TypeError) && !(e instanceof Error && /fetch|network|ENOTFOUND|ECONN/i.test(e.message));
      if (e instanceof ApiError) this.syncError = e.message;
    } finally {
      this.syncing = false;
      this.emitState();
    }
  }

  /** Server is authoritative: if it ended our session (limit, supersede, admin), stop locally. */
  private reconcile(server: { id: string; state: string; end_reason: string | null } | null): void {
    const s = this.session;
    if (!s || this.queue.size > 0) return;
    if (!server || server.id !== s.id) {
      this.activity.stop();
      this.apps.stop();
      this.session = null;
      this.persistSession();
      new Notification({ title: 'Tracking stopped', body: 'Your timer was stopped by the server (limit reached, started elsewhere, or stopped by an admin).' }).show();
    }
  }

  private async heartbeat(): Promise<void> {
    if (!this.api.signedIn) return;
    try {
      const r = await this.api.request<{ session: { id: string; state: string; end_reason: string | null } | null }>('POST', '/agent/heartbeat', { sent_at: new Date().toISOString(), session_id: this.session?.id ?? null, agent_version: this.version, capabilities: this.capabilities });
      this.online = true;
      this.reconcile(r.session);
    } catch {
      this.online = false;
    }
  }

  async refreshBootstrap(): Promise<void> {
    if (!this.api.signedIn) return;
    try {
      const b = await this.api.request<Bootstrap>('GET', '/agent/bootstrap');
      this.useAccount(accountOf(b));
      const policyChanged = this.boot && this.boot.policy_hash !== b.policy_hash;
      this.boot = b;
      this.remindTimesheet(b);
      this.todayBase = { seconds: b.today_seconds, at: Date.now() };
      this.weekBase = { seconds: b.week_seconds, at: Date.now() };
      if (this.recovery) this.recovery.projectName = b.assignments.find((a) => a.project_id === this.session?.projectId)?.project_name ?? '';
      if (policyChanged) {
        new Notification({ title: 'Tracking settings changed', body: 'Your organization updated its tracking settings.' }).show();
        this.emit('show');
        if (this.session?.state === 'active') {
          this.stopMonitors();
          this.startMonitors();
        }
      }
      // Another device/web started a timer: follow the server.
      if (this.session && b.current_session?.id !== this.session.id && this.queue.size === 0) this.reconcile(b.current_session ? { ...b.current_session, end_reason: null } : null);
      this.online = true;
      this.phase = 'ready';
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      this.online = false;
    }
    this.emitState();
  }

  /**
   * Called with the account that is signed in now. When it differs from the account whose data is
   * on this machine (someone else signed in), the previous account's timer is stopped into its own
   * queue at its last evidence, its per-person state is cleared, and the new account's queue is used.
   */
  private useAccount(account: string): void {
    if (this.account === account) return;
    if (this.account === null) {
      OfflineQueue.adoptLegacy(this.store, queueFileFor(account));
    } else {
      const s = this.session;
      if (s) {
        this.flushObservations();
        this.stopMonitors();
        s.seq += 1;
        this.enqueue({ type: 'session.stop', session_id: s.id, seq: s.seq, occurred_at: s.lastEvidenceAt });
        this.session = null;
        this.persistSession();
      }
      this.idle = null;
      this.recovery = null;
      this.lastProject = null;
      this.store.writeJson('last-project', null);
      this.manualRequests = [];
      this.store.writeJson('manual-requests', []);
    }
    this.account = account;
    this.store.writeJson('account', account);
    this.queue = new OfflineQueue(this.store, queueFileFor(account));
  }

  // ─── State for the UI ──────────────────────────────────────────────────────
  state(): AgentState {
    const s = this.session;
    const running = s?.state === 'active' && s.segmentStartedAt ? (Date.now() - Date.parse(s.segmentStartedAt)) / 1000 : 0;
    return {
      phase: this.phase,
      error: this.error,
      serverUrl: this.serverUrl,
      serverManaged: !!this.managedServer,
      version: this.version,
      account: this.boot
        ? { name: this.boot.worker.name, email: this.boot.worker.email, organization: this.boot.organization.name, organizationId: this.boot.organization.id, membershipId: this.boot.worker.membership_id, timezone: this.boot.worker.timezone }
        : null,
      device: this.boot?.device ?? null,
      policy: this.boot?.policy ?? null,
      assignments: this.boot?.assignments ?? [],
      tracking: {
        state: s ? s.state : 'stopped',
        sessionId: s?.id ?? null,
        projectId: s?.projectId ?? null,
        taskId: s?.taskId ?? null,
        startedAt: s?.startedAt ?? null,
        baseSeconds: Math.max(0, Math.round(s?.baseSeconds ?? 0)),
        segmentStartedAt: s?.state === 'active' ? s.segmentStartedAt : null,
        note: s?.note ?? '',
      },
      todaySeconds: Math.max(0, Math.round(this.todayBase.seconds + running)),
      weekSeconds: Math.max(0, Math.round(this.weekBase.seconds + running)),
      activityPct: this.activity.lastPct(),
      activityRecent: this.activity.recent(),
      recordingNow: s?.state === 'active' ? this.apps.now() : null,
      idlePrompt: this.idle && this.idle.endedAt !== null && this.boot?.policy.idle.behavior !== 'keep' ? { idleId: this.idle.idleId, startedAt: new Date(this.idle.startedAt).toISOString(), endedAt: new Date(this.idle.endedAt).toISOString() } : null,
      recoveryPrompt: this.recovery,
      sync: { queued: this.queue.size, lastSyncAt: this.lastSyncAt, online: this.online, error: this.syncError },
      capabilities: this.capabilities,
      browserExtension: this.urls.bridge.connectedBrowsers().map((b) => BROWSER_NAMES[b]),
      lastProject: this.lastProject,
      timesheetDue: this.boot?.timesheet_due
        ? { periodStart: this.boot.timesheet_due.period_start, periodEnd: this.boot.timesheet_due.period_end, status: this.boot.timesheet_due.status, totalSeconds: this.boot.timesheet_due.total_seconds, overdue: this.boot.timesheet_due.overdue }
        : null,
      manualRequests: this.manualRequests,
      breakTypes: this.boot?.break_types.map((bt) => ({ id: bt.id, name: bt.name, paid: bt.paid, maxMinutes: bt.max_minutes })) ?? [],
      breakTypeId: s?.state === 'paused' ? this.breakTypeId : null,
      nextShift: this.boot?.next_shift ? { startsAt: this.boot.next_shift.starts_at, endsAt: this.boot.next_shift.ends_at } : null,
    };
  }

  private emitState(): void {
    this.emit('state', this.state());
  }

  dispose(): void {
    for (const t of this.timers) clearInterval(t);
    this.stopMonitors();
    this.urls.stop();
  }
}
