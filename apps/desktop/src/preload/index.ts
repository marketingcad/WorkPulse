import { contextBridge, ipcRenderer } from 'electron';
import type { AgentState, IpcChannel } from '../shared/ipc';

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
  logout: () => call('auth:logout'),
  start: (projectId: string, taskId: string | null) => call('timer:start', { projectId, taskId }),
  switchTask: (projectId: string, taskId: string | null) => call('timer:switch', { projectId, taskId }),
  stop: () => call('timer:stop'),
  pause: () => call('timer:pause'),
  resume: () => call('timer:resume'),
  setNote: (note: string) => call('notes:set', { note }),
  resolveIdle: (choice: 'KEPT' | 'DISCARDED' | 'REASSIGNED', projectId?: string, taskId?: string | null) => call('idle:resolve', { choice, projectId, taskId }),
  acknowledgePolicy: () => call('policy:ack'),
  resolveRecovery: (resume: boolean) => call('recovery:resolve', { resume }),
  openWeb: (path: string) => call('app:openWeb', { path }),
  quit: () => call('app:quit'),
};

export type TallyworkBridge = typeof api;
contextBridge.exposeInMainWorld('tallywork', api);
