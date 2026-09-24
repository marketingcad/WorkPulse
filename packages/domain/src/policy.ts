/**
 * Tracking policy: what is monitored and how tracking behaves.
 * Resolution: org default ← team overrides ← worker override (deep partial merge).
 */

export interface TrackingPolicy {
  tracking: {
    allowWeb: boolean;
    allowDesktop: boolean;
    singleTimer: 'supersede' | 'reject';
    maxPauseMinutes: number;
    recoveryWindowMinutes: number;
    heartbeatGraceSeconds: number;
    maxOfflineHours: number;
  };
  activity: { enabled: boolean };
  idle: {
    enabled: boolean;
    thresholdMinutes: number;
    behavior: 'prompt' | 'pause' | 'keep';
    confirmationTimeoutMinutes: number;
    defaultResolution: 'keep' | 'discard';
  };
  screenshots: {
    enabled: boolean;
    perTenMinutes: 0 | 1 | 2 | 3;
    blur: boolean;
    notify: boolean;
    workerCanDelete: boolean;
    deleteRemovesTime: boolean;
  };
  apps: { enabled: boolean };
  urls: { enabled: boolean; mode: 'domain' | 'full'; excludedDomains: string[] };
  location: { enabled: boolean };
  limits: { dailySeconds: number | null; weeklySeconds: number | null };
  manualTime: { allowed: boolean; requiresApproval: boolean; reasonRequired: boolean };
  timeEdits: { workerCanEdit: boolean; reasonRequired: boolean };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer _U> ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export const DEFAULT_POLICY: TrackingPolicy = {
  tracking: {
    allowWeb: true,
    allowDesktop: true,
    singleTimer: 'supersede',
    maxPauseMinutes: 240,
    recoveryWindowMinutes: 15,
    heartbeatGraceSeconds: 180,
    maxOfflineHours: 24,
  },
  activity: { enabled: true },
  idle: {
    enabled: true,
    thresholdMinutes: 5,
    behavior: 'prompt',
    confirmationTimeoutMinutes: 10,
    defaultResolution: 'keep',
  },
  screenshots: {
    enabled: false,
    perTenMinutes: 1,
    blur: false,
    notify: true,
    workerCanDelete: true,
    deleteRemovesTime: true,
  },
  apps: { enabled: true },
  urls: { enabled: false, mode: 'domain', excludedDomains: [] },
  location: { enabled: false },
  limits: { dailySeconds: null, weeklySeconds: null },
  manualTime: { allowed: true, requiresApproval: true, reasonRequired: true },
  timeEdits: { workerCanEdit: true, reasonRequired: true },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function mergePolicy<T>(base: T, override: DeepPartial<T> | undefined | null): T {
  if (!override) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override)) {
    if (v === undefined) continue;
    const b = out[k];
    out[k] = isPlainObject(b) && isPlainObject(v) ? mergePolicy(b, v as DeepPartial<typeof b>) : v;
  }
  return out as T;
}

export interface PolicyLayer {
  scope: 'ORG' | 'TEAM' | 'WORKER';
  scopeId: string;
  doc: DeepPartial<TrackingPolicy>;
}

/**
 * Resolve the effective policy. Team layers are applied in the given order
 * (the service sorts them by team name for determinism), then the worker layer.
 */
export function resolvePolicy(layers: PolicyLayer[]): TrackingPolicy {
  const order = { ORG: 0, TEAM: 1, WORKER: 2 } as const;
  return [...layers]
    .sort((a, b) => order[a.scope] - order[b.scope])
    .reduce<TrackingPolicy>((acc, l) => mergePolicy(acc, l.doc), DEFAULT_POLICY);
}

/** Trim a URL according to policy; returns null when it must not be recorded. */
export function applyUrlPolicy(
  url: string,
  policy: TrackingPolicy['urls'],
): { domain: string; url: string | null } | null {
  if (!policy.enabled) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const domain = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const excluded = policy.excludedDomains.some((d) => {
    const x = d.toLowerCase().replace(/^www\./, '');
    return domain === x || domain.endsWith(`.${x}`);
  });
  if (excluded) return null;
  return { domain, url: policy.mode === 'full' ? `${parsed.origin}${parsed.pathname}` : null };
}
