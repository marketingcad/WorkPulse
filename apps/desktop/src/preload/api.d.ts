import type { AgentState } from '../shared/ipc';

declare global {
  interface Window {
    tallywork: {
      getState(): Promise<AgentState>;
      onState(cb: (s: AgentState) => void): () => void;
      login(serverUrl?: string): Promise<void>;
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
      requestManualTime(r: { projectId: string; taskId: string | null; startedAt: string; endedAt: string; reason: string; note?: string }): Promise<void>;
      openWeb(path: string): Promise<void>;
      quit(): Promise<void>;
    };
  }
}

export {};
