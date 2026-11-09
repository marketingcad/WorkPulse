import type { InsightResultDto } from '@tallywork/contracts';

/**
 * Short-lived cache for computed insights. The key always includes the organization AND the
 * membership, so one person's result (scoped to what they may see) is never served to another,
 * or across organizations. Five minutes: fresh enough for a dashboard, and it bounds repeated work.
 */
const TTL_MS = 5 * 60_000;
const MAX_KEYS = 500;
const store = new Map<string, { at: number; value: InsightResultDto }>();

export const insightCacheKey = (orgId: string, membershipId: string, section: string, from: string, to: string) => `${orgId}:${membershipId}:${section}:${from}:${to}`;

export const insightCache = {
  get(key: string, now: number): InsightResultDto | null {
    const hit = store.get(key);
    if (!hit) return null;
    if (now - hit.at > TTL_MS) {
      store.delete(key);
      return null;
    }
    return hit.value;
  },
  set(key: string, value: InsightResultDto, now: number): void {
    store.delete(key);
    store.set(key, { at: now, value });
    while (store.size > MAX_KEYS) store.delete(store.keys().next().value!);
  },
  clear(): void {
    store.clear();
  },
};
