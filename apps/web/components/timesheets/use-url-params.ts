'use client';
import { useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Read/write a few query-string params. Writes use the browser's history.replaceState, which Next.js
 * keeps in sync with useSearchParams: no navigation, so nothing on the page is reset (a click right
 * after changing a tab or filter is not lost), and each change starts from the current address, so
 * two changes in a row (From, then To) both stick. Replace, not push: Back leaves the page.
 */
export function useUrlParams<K extends string>(keys: readonly K[]): [Record<K, string | null>, (patch: Partial<Record<K, string | null>>) => void] {
  const sp = useSearchParams();
  const values = Object.fromEntries(keys.map((k) => [k, sp.get(k)])) as Record<K, string | null>;
  const set = useCallback((patch: Partial<Record<K, string | null>>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch) as Array<[string, string | null | undefined]>) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const s = next.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${s ? `?${s}` : ''}${window.location.hash}`);
  }, []);
  return [values, set];
}
