import type { AgentState, LoginResult, MeResource } from '../shared/ipc';

declare global {
  interface Window {
    tallywork: {
      getState(): Promise<AgentState>;
      onState(cb: (s: AgentState) => void): () => void;
      login(serverUrl?: string): Promise<void>;
      loginWithPassword(r: { email: string; password: string; mfaCode?: string; organizationId?: string; serverUrl?: string }): Promise<LoginResult>;
      logout(): Promise<void>;
      start(projectId: string, taskId: string | null): Promise<void>;
      switchTask(projectId: string, taskId: string | null): Promise<void>;
      stop(): Promise<void>;
      pause(): Promise<void>;
      resume(): Promise<void>;
      setNote(note: string): Promise<void>;
      resolveIdle(choice: 'KEPT' | 'DISCARDED' | 'REASSIGNED', projectId?: string, taskId?: string | null): Promise<void>;
      acknowledgePolicy(): Promise<void>;
      resolveRecovery(resume: boolean): Promise<void>;
      takeBreak(breakTypeId: string | null): Promise<void>;
      requestManualTime(r: { projectId: string; taskId: string | null; startedAt: string; endedAt: string; reason: string; note?: string }): Promise<void>;
      me<T>(resource: MeResource, params?: { from?: string; to?: string; date?: string }): Promise<T>;
      submitTimesheet(date: string, version?: number): Promise<unknown>;
      requestTimeOff(r: { policy_id: string; start_date: string; end_date: string; half_day?: boolean; reason?: string }): Promise<unknown>;
      readNotifications(ids: string[] | 'all'): Promise<void>;
      openWeb(path: string): Promise<void>;
      quit(): Promise<void>;
    };
  }
}

export {};
