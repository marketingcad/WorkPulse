import { readFileSync } from 'node:fs';
import { test as base, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import type { AgentBootstrapDto } from '@tallywork/contracts';
import type { AgentState, MeResource } from '../../apps/desktop/src/shared/ipc';
import { ADMIN_STATE, DATA_FILE, PASSWORD, WEB_URL } from './env';
import type { E2EData } from './global-setup';

/** A desktop-app sign-in: a real device registered through POST /agent/login (email + password). */
export interface Device {
  token: string;
  boot: AgentBootstrapDto;
}

export interface DesktopOptions {
  /** Own-data resources whose requests fail as if the computer were offline. */
  offline?: MeResource[];
}

export interface DesktopHandle {
  /** PDFs the page saved through the bridge (what the Electron main process would write to disk). */
  savedPdfs: Array<{ id: string; bytes: Buffer }>;
}

async function signInDevice(email: string): Promise<Device> {
  const api = await request.newContext({ baseURL: WEB_URL });
  const login = await api.post('/api/v1/agent/login', { data: { email, password: PASSWORD, device: { name: `E2E ${email}`, platform: 'windows', agent_version: '0.1.5' } } });
  if (login.status() !== 201) throw new Error(`device sign-in for ${email}: HTTP ${login.status()} ${await login.text()}`);
  const token = (await login.json()).access_token as string;
  const boot = await api.get('/api/v1/agent/bootstrap', { headers: { Authorization: `Bearer ${token}` } });
  if (!boot.ok()) throw new Error(`bootstrap: HTTP ${boot.status()}`);
  const device = { token, boot: (await boot.json()) as AgentBootstrapDto };
  await api.dispose();
  return device;
}

/** The signed-in, ready state the main process reports once bootstrap has run. */
function readyState(d: Device): AgentState {
  const b = d.boot;
  return {
    phase: 'ready',
    error: null,
    serverUrl: WEB_URL,
    serverManaged: false,
    version: '0.1.5',
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
    capabilities: {},
    browserExtension: [],
    lastProject: null,
    timesheetDue: null,
    manualRequests: [],
    breakTypes: b.break_types.map((x) => ({ id: x.id, name: x.name, paid: x.paid, maxMinutes: x.max_minutes })),
    breakTypeId: null,
    nextShift: null,
  };
}

/**
 * Opens the desktop app's window with `window.tallywork` (src/preload) replaced by a bridge that
 * does what the main process does: build /api/v1/agent/me/* paths from the same allowlist and call
 * the server with the device's token. The page code and the API are the real ones.
 */
async function openDesktop(page: Page, device: Device, opts: DesktopOptions = {}): Promise<DesktopHandle> {
  const handle: DesktopHandle = { savedPdfs: [] };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${WEB_URL}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${device.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { title?: string }).title ?? `Request failed (${res.status})`);
    return res;
  };
  await page.exposeFunction('__e2eBridge', async (op: string, args: any) => {
    switch (op) {
      case 'getState':
        return readyState(device);
      case 'me': {
        if (opts.offline?.includes(args.resource)) throw new Error('Could not reach the server. Check your connection.');
        const q = new URLSearchParams();
        for (const k of ['from', 'to', 'date'] as const) if (args.params?.[k]) q.set(k, args.params[k]);
        const res = await call('GET', `/agent/me/${args.resource}${q.size ? `?${q}` : ''}`);
        return res.status === 204 ? undefined : res.json();
      }
      case 'savePayStub': {
        const res = await call('GET', `/agent/me/pay-stubs/${args.id}/pdf`);
        handle.savedPdfs.push({ id: args.id, bytes: Buffer.from(await res.arrayBuffer()) });
        return { saved: true };
      }
      case 'readNotifications':
        await call('POST', '/agent/me/notifications/read', { ids: args.ids });
        return undefined;
      default:
        throw new Error(`"${op}" is not available in the E2E desktop bridge`);
    }
  });
  await page.addInitScript(() => {
    const b = (op: string, args?: unknown) => (window as any).__e2eBridge(op, args);
    const unavailable = (op: string) => () => b(op);
    (window as any).tallywork = {
      getState: () => b('getState'),
      onState: () => () => undefined,
      onNavigate: () => () => undefined,
      me: (resource: string, params = {}) => b('me', { resource, params }),
      savePayStub: (id: string) => b('savePayStub', { id }),
      readNotifications: (ids: string[] | 'all') => b('readNotifications', { ids }),
      ...Object.fromEntries(['login', 'loginWithPassword', 'logout', 'start', 'switchTask', 'stop', 'pause', 'resume', 'takeBreak', 'setNote', 'resolveIdle', 'resolveRecovery', 'requestManualTime', 'submitTimesheet', 'requestTimeOff', 'quit'].map((op) => [op, unavailable(op)])),
    };
  });
  await page.goto('/');
  return handle;
}

interface WorkerFixtures {
  data: E2EData;
  workerDevice: Device;
  newcomerDevice: Device;
}

interface TestFixtures {
  openDesktop: (device: Device, opts?: DesktopOptions) => Promise<DesktopHandle>;
  /**
   * The admin's API session, for a test to create its own records (unique names) before driving the UI.
   * `orgApi(path)` gives the org-scoped URL, e.g. `orgApi('/clients')`.
   */
  adminApi: { api: APIRequestContext; orgApi: (path: string) => string };
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  data: [async ({}, use) => use(JSON.parse(readFileSync(DATA_FILE, 'utf8')) as E2EData), { scope: 'worker' }],
  // One device sign-in per worker process (device sign-in is rate-limited, like in production).
  workerDevice: [async ({ data }, use) => use(await signInDevice(data.worker.email)), { scope: 'worker' }],
  newcomerDevice: [async ({ data }, use) => use(await signInDevice(data.newcomer.email)), { scope: 'worker' }],
  openDesktop: async ({ page }, use) => use((device, opts) => openDesktop(page, device, opts)),
  adminApi: async ({ data }, use) => {
    const api = await request.newContext({ baseURL: WEB_URL, storageState: ADMIN_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
    await use({ api, orgApi: (path) => `/api/v1/orgs/${data.orgId}${path}` });
    await api.dispose();
  },
});

/** Fail with the server's answer when an API call made to set up a test does not succeed. */
export async function ok<T = any>(res: Awaited<ReturnType<APIRequestContext['get']>>, what: string): Promise<T> {
  if (!res.ok()) throw new Error(`${what}: HTTP ${res.status()} ${await res.text()}`);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

export { expect };

/** Money as the desktop app shows it (en-US, USD). */
export const usd = (minor: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
