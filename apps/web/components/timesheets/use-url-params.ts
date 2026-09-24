'use client';
import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Read/write a few query-string params (replace, no scroll). Use inside <Suspense>. */
export function useUrlParams<K extends string>(keys: readonly K[]): [Record<K, string | null>, (patch: Partial<Record<K, string | null>>) => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const values = Object.fromEntries(keys.map((k) => [k, sp.get(k)])) as Record<K, string | null>;
  const set = useCallback(
    (patch: Partial<Record<K, string | null>>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch) as Array<[string, string | null | undefined]>) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [sp, router, pathname],
  );
  return [values, set];
}
