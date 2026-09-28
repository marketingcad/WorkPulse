import { contextBridge, ipcRenderer } from 'electron';
import type { AgentState, IpcChannel, LoginResult, MeResource } from '../shared/ipc';

/**
 * Minimal, typed bridge. No generic invoke, no ipcRenderer, no Node APIs are
 * exposed to the renderer. Payloads are validated again in the main process.
 */
const call = (channel: IpcChannel, payload?: unknown) => ipcRenderer.invoke(channel, payload);

const api = {
  getState: (): Promise<AgentState> => call('state:get'),
  onState: (cb: (s: AgentState) => void): (() => void) => {
    const listener = (_: unknown, s: AgentState) => cb(s);
    ipcRenderer.on('state:changed', listener);
    return () => ipcRenderer.removeListener('state:changed', listener);
  },
  login: (serverUrl?: string) => call('auth:login', { serverUrl }),
  /** Email + password sign-in; resolves with the next step (2FA code or organization choice) when one is needed. */
  loginWithPassword: (r: { email: string; password: string; mfaCode?: string; organizationId?: string; serverUrl?: string }): Promise<LoginResult> => call('auth:loginPassword', r),
  logout: () => call('auth:logout'),
  start: (projectId: string, taskId: string | null) => call('timer:start', { projectId, taskId }),
  switchTask: (projectId: string, taskId: string | null) => call('timer:switch', { projectId, taskId }),
  stop: () => call('timer:stop'),
  pause: () => call('timer:pause'),
  resume: () => call('timer:resume'),
  takeBreak: (breakTypeId: string | null) => call('timer:break', { breakTypeId }),
  setNote: (note: string) => call('notes:set', { note }),
  resolveIdle: (choice: 'KEPT' | 'DISCARDED' | 'REASSIGNED', projectId?: string, taskId?: string | null) => call('idle:resolve', { choice, projectId, taskId }),
  acknowledgePolicy: () => call('policy:ack'),
  resolveRecovery: (resume: boolean) => call('recovery:resolve', { resume }),
  requestManualTime: (r: { projectId: string; taskId: string | null; startedAt: string; endedAt: string; reason: string; note?: string }) => call('manualTime:request', r),
  /** The signed-in worker's own data (read-only). */
  me: <T>(resource: MeResource, params: { from?: string; to?: string; date?: string } = {}): Promise<T> => call('me:get', { resource, ...params }),
  submitTimesheet: (date: string, version?: number) => call('me:submitTimesheet', { date, version }),
  requestTimeOff: (r: { policy_id: string; start_date: string; end_date: string; half_day?: boolean; reason?: string }) => call('me:requestTimeOff', r),
  readNotifications: (ids: string[] | 'all') => call('me:readNotifications', { ids }),
  /** Main asks to show a page, e.g. after a desktop notification is clicked. */
  onNavigate: (cb: (view: string) => void): (() => void) => {
    const listener = (_: unknown, view: string) => cb(view);
    ipcRenderer.on('app:navigate', listener);
    return () => ipcRenderer.removeListener('app:navigate', listener);
  },
  quit: () => call('app:quit'),
};

export type TallyworkBridge = typeof api;
contextBridge.exposeInMainWorld('tallywork', api);
