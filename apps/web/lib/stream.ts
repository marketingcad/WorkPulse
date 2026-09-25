'use client';
import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useOrgId } from '@/lib/api';

/**
 * Live updates: listens to the organization's event stream (server-sent events) and refetches
 * org queries whose path starts with one of `prefixes` when something changes. Events carry
 * only a type and a worker id; the data itself is always refetched through the API.
 * The browser reconnects on its own and resumes from the last event it saw.
 */
export function useOrgStream(prefixes: string[]) {
  const orgId = useOrgId();
  const qc = useQueryClient();
  const key = prefixes.join('|');
  useEffect(() => {
    if (!orgId || typeof EventSource === 'undefined') return;
    const list = key.split('|');
    const es = new EventSource(`/api/v1/orgs/${orgId}/stream`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      // Coalesce bursts (e.g. a batch of offline events) into one refetch.
      timer = setTimeout(() => {
        timer = null;
        void qc.invalidateQueries({ predicate: (q) => matches(q.queryKey, orgId, list) });
      }, 500);
    };
    es.addEventListener('change', refresh);
    return () => {
      es.close();
      if (timer) clearTimeout(timer);
    };
  }, [orgId, key, qc]);
}

function matches(k: QueryKey, orgId: string, prefixes: string[]): boolean {
  return k[0] === 'org' && k[1] === orgId && typeof k[2] === 'string' && prefixes.some((p) => (k[2] as string).startsWith(p));
}
