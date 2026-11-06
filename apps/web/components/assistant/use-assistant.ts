'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssistantConversationDto, AssistantMessageDto, AssistantStreamEvent } from '@tallywork/contracts';
import { api, ApiError } from '@/lib/api';
import { streamAssistantMessage } from './stream';

export type Conversation = AssistantConversationDto & { messages: AssistantMessageDto[] };
export interface Streaming {
  userText: string;
  text: string;
  toolStatus: string | null;
  nav: AssistantMessageDto['nav'];
}
export interface AssistantError {
  code: string;
  retryable: boolean;
}

const storageKey = (orgId: string) => `tw.assistant.active.${orgId}`;
function readActive(orgId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(orgId));
  } catch {
    return null;
  }
}
function writeActive(orgId: string, id: string | null) {
  try {
    if (id) window.localStorage.setItem(storageKey(orgId), id);
    else window.localStorage.removeItem(storageKey(orgId));
  } catch {
    /* storage unavailable: the active chat simply isn't remembered */
  }
}

/** State and actions of the WorkPulse AI panel for one organization. */
export function useAssistant(orgId: string, enabled: boolean) {
  const qc = useQueryClient();
  const base = `/orgs/${orgId}/assistant`;
  // The panel renders only in the browser (dynamic, ssr: false), so storage can be read at once.
  const [activeId, setActiveIdState] = useState<string | null>(() => (typeof window === 'undefined' ? null : readActive(orgId)));
  const [streaming, setStreaming] = useState<Streaming | null>(null);
  const [error, setError] = useState<AssistantError | null>(null);
  const [lastUserText, setLastUserText] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setActiveIdState(readActive(orgId));
  }, [orgId]);
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const setActiveId = useCallback(
    (id: string | null) => {
      setActiveIdState(id);
      writeActive(orgId, id);
    },
    [orgId],
  );

  const list = useQuery({
    queryKey: ['assistant', orgId, 'list'],
    queryFn: ({ signal }) => api<{ data: AssistantConversationDto[] }>(`${base}/conversations?page=1&page_size=50`, { signal }),
    enabled,
  });
  const active = useQuery({
    queryKey: ['assistant', orgId, 'conversation', activeId],
    queryFn: ({ signal }) => api<Conversation>(`${base}/conversations/${activeId}`, { signal }),
    enabled: enabled && !!activeId,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  // A remembered conversation that no longer exists (deleted, purged): start fresh.
  useEffect(() => {
    if (active.error instanceof ApiError && active.error.status === 404) setActiveId(null);
  }, [active.error, setActiveId]);

  const refresh = useCallback(
    (id: string | null) =>
      Promise.all([qc.invalidateQueries({ queryKey: ['assistant', orgId, 'list'] }), id ? qc.invalidateQueries({ queryKey: ['assistant', orgId, 'conversation', id] }) : undefined]),
    [qc, orgId],
  );

  const send = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || streaming) return;
      setError(null);
      setLastUserText(text);
      setAnnouncement('');
      let id = activeId;
      try {
        if (!id) {
          const created = await api<AssistantConversationDto>(`${base}/conversations`, { body: {} });
          id = created.id;
          setActiveId(id);
        }
      } catch (e) {
        setError({ code: e instanceof ApiError ? e.code : 'internal', retryable: true });
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const state: Streaming = { userText: text, text: '', toolStatus: null, nav: [] };
      setStreaming({ ...state });
      let failed: AssistantError | null = null;
      const onEvent = (e: AssistantStreamEvent) => {
        if (e.event === 'delta') state.text += e.data.text;
        else if (e.event === 'tool_status') state.toolStatus = e.data.state === 'running' ? e.data.tool : null;
        else if (e.event === 'nav') state.nav = [...state.nav, e.data];
        else if (e.event === 'error') failed = { code: e.data.code, retryable: e.data.retryable };
        setStreaming({ ...state });
      };
      try {
        await streamAssistantMessage(orgId, id, { content: text, route: window.location.pathname }, onEvent, controller.signal);
      } catch (e) {
        if (controller.signal.aborted) failed = null;
        else failed = { code: e instanceof ApiError ? e.code : 'internal', retryable: true };
      } finally {
        abortRef.current = null;
        await refresh(id);
        setStreaming(null);
        if (failed) setError(failed);
        else if (state.text) setAnnouncement(state.text);
      }
    },
    [activeId, base, orgId, refresh, setActiveId, streaming],
  );

  const retry = useCallback(() => (lastUserText ? send(lastUserText) : undefined), [lastUserText, send]);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setActiveId(null);
    setError(null);
    setLastUserText(null);
  }, [setActiveId]);

  const select = useCallback(
    (id: string) => {
      abortRef.current?.abort();
      setActiveId(id);
      setError(null);
    },
    [setActiveId],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      await api(`${base}/conversations/${id}`, { method: 'PATCH', body: { title } });
      await refresh(id);
    },
    [base, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await api(`${base}/conversations/${id}`, { method: 'DELETE' });
      if (id === activeId) newChat();
      qc.removeQueries({ queryKey: ['assistant', orgId, 'conversation', id] });
      await refresh(null);
    },
    [activeId, base, newChat, orgId, qc, refresh],
  );

  return {
    conversations: list.data?.data ?? [],
    listLoading: list.isLoading,
    active: activeId ? (active.data ?? null) : null,
    activeLoading: !!activeId && active.isLoading,
    activeError: active.error && !(active.error instanceof ApiError && active.error.status === 404) ? active.error : null,
    reloadActive: () => active.refetch(),
    streaming,
    error,
    announcement,
    send,
    retry,
    newChat,
    select,
    rename,
    remove,
  };
}
