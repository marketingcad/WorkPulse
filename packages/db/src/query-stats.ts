import { AsyncLocalStorage } from 'node:async_hooks';

/** Database work done while handling one request: what Server-Timing and the request log report. */
export interface QueryStats {
  /** statements sent (each one is a round trip to the database) */
  queries: number;
  /** time spent waiting for those statements */
  ms: number;
  /** new connections opened (each one adds a TLS handshake and the session setup) */
  connects: number;
}

const store = new AsyncLocalStorage<QueryStats>();

/** Runs `fn` with a fresh counter; every query made inside it, however deep, is counted. */
export function withQueryStats<T>(fn: (stats: QueryStats) => Promise<T>): Promise<T> {
  const stats: QueryStats = { queries: 0, ms: 0, connects: 0 };
  return store.run(stats, () => fn(stats));
}

export function currentQueryStats(): QueryStats | undefined {
  return store.getStore();
}

/** Replaces `target[method]` with a version that counts each call and the time until it settles. */
export function countCalls(target: object, method: string): void {
  const t = target as Record<string, (...args: unknown[]) => unknown>;
  const original = t[method]!.bind(target);
  t[method] = (...args: unknown[]) => {
    const stats = store.getStore();
    if (!stats) return original(...args);
    stats.queries++;
    const started = performance.now();
    const result = original(...args);
    if (result instanceof Promise) return result.finally(() => (stats.ms += performance.now() - started));
    return result;
  };
}
