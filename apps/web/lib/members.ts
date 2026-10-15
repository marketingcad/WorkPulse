'use client';
import type { MemberOptionDto } from '@tallywork/contracts';
import { useOrgQuery } from './api';

/**
 * Every member the person may see, for pickers and name lookups: id, name, status and the few
 * fields those need, from GET /workers/options (no rates or team lists, so it stays light).
 * Shared and cached across pages; pass `false` to skip it.
 */
export function useMemberOptions(enabled = true, opts: { includeRemoved?: boolean } = {}) {
  return useOrgQuery<MemberOptionDto[]>(enabled ? `/workers/options${opts.includeRemoved ? '?include_removed=true' : ''}` : null, { staleTime: 60_000 });
}
