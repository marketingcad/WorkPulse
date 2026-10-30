import type { Page } from '@playwright/test';
import type { AgentBootstrapDto } from '@tallywork/contracts';
import type { AgentState } from '../../apps/desktop/src/shared/ipc';
import { DEMO_PASSWORD, PEOPLE, TUTORIAL_URL } from './env';

/**
 * The desktop app's window for the recordings, served by scripts/serve-desktop.mjs.
 *
 * Like support/fixtures.ts, `window.tallywork` (src/preload) is replaced by a bridge, but this one
 * also plays the main process's part on screen: Clock in, a break, Clock out and the sign-in form
 * change the window's state the way the real app does, so the viewer sees each step happen. The
 * timer is real too: clocking in, breaks and clocking out (with the end-of-day report) are sent as
 * the app's session events, so managers see them on Live and End-of-day reports. Reads (`me`:
 * timesheet, sessions, pay stubs…) and the worker's own requests (submit a timesheet, ask for time
 * off) go to the real API with the same device token the main process would use.
 */

/** A desktop-app sign-in for a demo member (Ava by default), refreshed before its 10-minute access token expires. */
export class WorkerDevice {
  constructor(
    private readonly email: string = PEOPLE.worker.email,
    private readonly deviceName = 'Ava’s ThinkPad',
  ) {}

  private token = '';
  private refresh = '';
  private at = 0;
  boot!: AgentBootstrapDto;
  /**
   * The timer as the window last left it (running, on a break…). The real app keeps this in its
   * main process across window reloads; here it carries one scene's state into the next.
   */
  carried: Partial<AgentState> = {};
  /** The current session's event sequence number, which the server requires to keep increasing. */
  seq = 0;

  async signIn(): Promise<void> {
    const res = await fetch(`${TUTORIAL_URL}/api/v1/agent/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: DEMO_PASSWORD, device: { name: this.deviceName, platform: 'windows', agent_version: '0.1.9' } }),
    });
    if (res.status !== 201) throw new Error(`desktop sign-in: HTTP ${res.status} ${await res.text()}`);
    this.keep(await res.json());
    this.boot = (await this.call('GET', '/agent/bootstrap').then((r) => r.json())) as AgentBootstrapDto;
  }

  private keep(t: { access_token: string; refresh_token: string }): void {
    this.token = t.access_token;
    this.refresh = t.refresh_token;
    this.at = Date.now();
  }

  async call(method: string, path: string, body?: unknown): Promise<Response> {
    if (Date.now() - this.at > 8 * 60_000) {
      const r = await fetch(`${TUTORIAL_URL}/api/v1/agent/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: this.refresh }) });
      if (!r.ok) throw new Error(`desktop token refresh: HTTP ${r.status}`);
      this.keep(await r.json());
    }
    const res = await fetch(`${TUTORIAL_URL}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { title?: string }).title ?? `Request failed (${res.status})`);
    return res;
  }

  /** The signed-in, stopped state the main process reports once bootstrap has run. */
  ready(): AgentState {
    const b = this.boot;
    return {
      phase: 'ready',
      error: null,
      serverUrl: TUTORIAL_URL,
      serverManaged: false,
      version: '0.1.9',
      account: { name: b.worker.name, email: b.worker.email, organization: b.organization.name, organizationId: b.organization.id, membershipId: b.worker.membership_id, timezone: b.worker.timezone },
      device: b.device,
      policy: b.policy,
      assignments: b.assignments,
      tracking: { state: 'stopped', sessionId: null, projectId: null, taskId: null, startedAt: null, baseSeconds: 0, segmentStartedAt: null, note: '' },
      todaySeconds: b.today_seconds,
      weekSeconds: b.week_seconds,
      activityPct: null,
      activityRecent: [],
      recordingNow: null,
      idlePrompt: null,
      recoveryPrompt: null,
      sync: { queued: 0, lastSyncAt: new Date().toISOString(), online: true, error: null },
      capabilities: { input: true, screenshots: true, apps: true, urls: true },
      browserExtension: ['Chrome'],
      lastProject: null,
      timesheetDue: null,
      manualRequests: [],
      breakTypes: b.break_types.map((x) => ({ id: x.id, name: x.name, paid: x.paid, maxMinutes: x.max_minutes })),
      breakTypeId: null,
      breakStartedAt: null,
      breakMinutes: null,
      nextShift: null,
      ...this.carried,
    };
  }
}

export interface DesktopOptions {
  /** Start on the sign-in screen; signing in with the form then shows `state`. */
  signedOut?: boolean;
  /** Start from this state instead of signed in and stopped. */
  state?: (ready: AgentState) => AgentState;
}

/** Opens the desktop window with the presenting bridge. */
export async function openDesktop(page: Page, device: WorkerDevice, opts: DesktopOptions = {}): Promise<void> {
  const start = opts.state ? opts.state(device.ready()) : device.ready();
  await page.exposeFunction('__tutorialApi', async (op: string, args: any) => {
    switch (op) {
      case 'init':
        return { state: start, signedOut: !!opts.signedOut };
      case 'me': {
        const q = new URLSearchParams();
        for (const k of ['from', 'to', 'date'] as const) if (args.params?.[k]) q.set(k, args.params[k]);
        const res = await device.call('GET', `/agent/me/${args.resource}${q.size ? `?${q}` : ''}`);
        return res.status === 204 ? undefined : res.json();
      }
      case 'track': {
        // One session event, as the main process sends it (src/main ingest queue).
        const { type, sessionId, ...rest } = args;
        if (type === 'session.start') device.seq = 0;
        const at = new Date().toISOString();
        await device.call('POST', '/agent/ingest/batch', { sent_at: at, events: [{ event_id: crypto.randomUUID(), type, session_id: sessionId, seq: ++device.seq, occurred_at: at, ...rest }] });
        return undefined;
      }
      case 'remember':
        device.carried = args;
        return undefined;
      case 'submitTimesheet':
        return (await device.call('POST', '/agent/me/timesheet/submit', args)).json();
      case 'requestTimeOff':
        return (await device.call('POST', '/agent/me/time-off', args)).json();
      case 'readNotifications':
        await device.call('POST', '/agent/me/notifications/read', args);
        return undefined;
      case 'savePayStub':
        await device.call('GET', `/agent/me/pay-stubs/${args.id}/pdf`);
        return { saved: true };
      default:
        throw new Error(`"${op}" is not available in the tutorial desktop bridge`);
    }
  });
  await page.addInitScript(() => {
    const api = (op: string, args?: unknown) => (window as any).__tutorialApi(op, args);
    const listeners = new Set<(s: any) => void>();
    let ready: any = null;
    let state: any = null;
    const now = () => new Date().toISOString();
    const set = (patch: any) => {
      state = { ...state, ...patch, tracking: { ...state.tracking, ...(patch.tracking ?? {}) } };
      for (const cb of listeners) cb(state);
      const { tracking, todaySeconds, weekSeconds, breakTypeId, breakStartedAt, breakMinutes, lastProject, manualRequests } = state;
      void api('remember', { tracking, todaySeconds, weekSeconds, breakTypeId, breakStartedAt, breakMinutes, lastProject, manualRequests });
    };
    const running = () => (state.tracking.segmentStartedAt ? Math.floor((Date.now() - Date.parse(state.tracking.segmentStartedAt)) / 1000) : 0);
    const init = api('init').then((r: any) => {
      ready = r.state;
      state = r.signedOut ? { ...r.state, phase: 'signed_out', account: null } : r.state;
      return state;
    });
    // The recording sets states the main process would reach on its own (an idle prompt, a break running long).
    (window as any).__tutorialSet = (patch: any) => set(patch);
    (window as any).tallywork = {
      getState: () => init.then(() => state),
      onState: (cb: (s: any) => void) => (listeners.add(cb), () => listeners.delete(cb)),
      onNavigate: () => () => undefined,
      me: (resource: string, params = {}) => api('me', { resource, params }),
      login: async () => undefined,
      loginWithPassword: async () => {
        set({ phase: 'signing_in' });
        await new Promise((r) => setTimeout(r, 900));
        state = ready;
        for (const cb of listeners) cb(state);
        return { status: 'signed_in' };
      },
      logout: async () => set({ phase: 'signed_out', account: null }),
      start: async (projectId: string, taskId: string | null) => {
        const sessionId = crypto.randomUUID();
        set({ tracking: { state: 'active', sessionId, projectId, taskId, startedAt: now(), baseSeconds: 0, segmentStartedAt: now(), note: '' }, lastProject: { projectId, taskId } });
        await api('track', { type: 'session.start', sessionId, project_id: projectId, task_id: taskId });
      },
      switchTask: async (projectId: string, taskId: string | null) => set({ tracking: { projectId, taskId }, lastProject: { projectId, taskId } }),
      stop: async (report?: { text: string; finished: boolean }) => {
        const sessionId = state.tracking.sessionId;
        const worked = state.tracking.baseSeconds + running();
        set({ tracking: { state: 'stopped', sessionId: null, startedAt: null, baseSeconds: 0, segmentStartedAt: null }, todaySeconds: state.todaySeconds + worked, weekSeconds: state.weekSeconds + worked, breakTypeId: null, breakStartedAt: null, breakMinutes: null });
        if (sessionId) await api('track', { type: 'session.stop', sessionId, ...(report ? { report } : {}) });
      },
      pause: async () => {
        set({ tracking: { state: 'paused', baseSeconds: state.tracking.baseSeconds + running(), segmentStartedAt: null } });
        await api('track', { type: 'session.pause', sessionId: state.tracking.sessionId, kind: 'MANUAL' });
      },
      resume: async () => {
        set({ tracking: { state: 'active', segmentStartedAt: now() }, breakTypeId: null, breakStartedAt: null, breakMinutes: null });
        await api('track', { type: 'session.resume', sessionId: state.tracking.sessionId });
      },
      takeBreak: async (breakTypeId: string | null, minutes: number | null) => {
        set({ tracking: { state: 'paused', baseSeconds: state.tracking.baseSeconds + running(), segmentStartedAt: null }, breakTypeId, breakStartedAt: now(), breakMinutes: minutes ?? null });
        await api('track', { type: 'session.pause', sessionId: state.tracking.sessionId, kind: 'BREAK', break_type_id: breakTypeId });
      },
      setNote: async (note: string) => set({ tracking: { note } }),
      resolveIdle: async () => set({ idlePrompt: null }),
      resolveRecovery: async () => set({ recoveryPrompt: null }),
      requestManualTime: async (r: any) =>
        set({ manualRequests: [{ id: crypto.randomUUID(), projectId: r.projectId, startedAt: r.startedAt, endedAt: r.endedAt, status: 'sent', message: null }, ...state.manualRequests] }),
      submitTimesheet: (date: string, version?: number) => api('submitTimesheet', { date, version }),
      requestTimeOff: (r: unknown) => api('requestTimeOff', r),
      readNotifications: (ids: unknown) => api('readNotifications', { ids }),
      savePayStub: (id: string) => api('savePayStub', { id }),
      quit: async () => undefined,
    };
  });
  await page.goto('/');
}

/**
 * Puts demo members to work right now, as their desktop apps would: a session started some time
 * ago on one of their projects, with activity, the apps they used, and a heartbeat. The seed's
 * own "working now" sessions are long stale by the time the Live scene is recorded.
 */
export async function startWorking(emails: string[]): Promise<void> {
  const apps = ['Figma', 'Chrome', 'VS Code', 'Slack', 'Google Docs'];
  for (const [i, email] of emails.entries()) {
    const dev = new WorkerDevice(email, 'Work laptop');
    await dev.signIn();
    const project = dev.boot.assignments[i % dev.boot.assignments.length];
    if (!project) continue;
    const now = Date.now();
    const minutes = 25 + i * 17;
    const start = new Date(now - minutes * 60_000);
    const sessionId = crypto.randomUUID();
    const ev = (type: string, extra: Record<string, unknown>) => ({ event_id: crypto.randomUUID(), type, session_id: sessionId, occurred_at: new Date(now - 30_000).toISOString(), ...extra });
    await dev.call('POST', '/agent/ingest/batch', {
      sent_at: new Date(now).toISOString(),
      events: [
        { ...ev('session.start', { seq: 1, project_id: project.project_id }), occurred_at: start.toISOString() },
        ev('activity.minutes', {
          minutes: Array.from({ length: minutes - 1 }, (_, m) => {
            const active = 30 + ((m * 7 + i * 11) % 30);
            return { minute_start: new Date(start.getTime() + m * 60_000).toISOString(), keyboard: active * 2, mouse: active, active_seconds: active, tracked_seconds: 60 };
          }),
        }),
        ev('app.spans', { spans: [{ span_id: crypto.randomUUID(), app_name: apps[i % apps.length], app_id: `${apps[i % apps.length]!.toLowerCase().replace(/\s/g, '')}.exe`, started_at: start.toISOString(), ended_at: new Date(now - 60_000).toISOString() }] }),
      ],
    });
    await dev.call('POST', '/agent/heartbeat', { sent_at: new Date().toISOString(), session_id: sessionId, agent_version: '0.1.9' });
  }
}
