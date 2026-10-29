'use client';
import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { useParams } from 'next/navigation';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public title: string,
    public requestId?: string,
    public errors?: Array<{ field: string; message: string }>,
  ) {
    super(title);
  }
  get request_id() {
    return this.requestId;
  }
  /** Field-level message for forms. */
  field(name: string): string | undefined {
    return this.errors?.find((e) => e.field === name)?.message;
  }
  /**
   * What a form's general alert should say, given the fields it shows errors beside: the title when
   * there are no field errors, otherwise the field errors the form has no place for (audit 30 Oct
   * 2026, VF-21), so no problem goes unshown. Undefined when every error sits beside its field.
   */
  general(shown: readonly string[]): string | undefined {
    if (!this.errors?.length) return this.title;
    const rest = this.errors.filter((e) => !shown.includes(e.field));
    return rest.length ? rest.map((e) => e.message).join(' ') : undefined;
  }
}

export const NETWORK_ERROR = "We couldn't reach WorkPulse. Check your connection and try again.";

/** Set once a request in this tab has succeeded: a 401 after that means the session ended, not that the person never signed in. */
let hadSession = false;

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; raw?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: init.body !== undefined && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body === undefined ? undefined : init.body instanceof FormData ? init.body : JSON.stringify(init.body),
      credentials: 'same-origin',
      signal: init.signal,
    });
  } catch (e) {
    // A cancelled request stays a cancellation; anything else is the connection (the browser says only "Failed to fetch").
    if (init.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e;
    throw new ApiError(0, 'network_error', NETWORK_ERROR);
  }
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}${hadSession ? '&reason=expired' : ''}`;
    // The page is leaving: no error toast in the meantime.
    return new Promise<never>(() => undefined);
  }
  if (res.ok && !path.startsWith('/auth/')) hadSession = true;
  if (!res.ok) {
    let p: { title?: string; code?: string; request_id?: string; errors?: Array<{ field: string; message: string }> } = {};
    try {
      p = await res.json();
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, p.code ?? 'error', p.title ?? `Request failed (${res.status})`, p.request_id, p.errors);
  }
  if (init.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function useOrgId(): string {
  const p = useParams<{ orgId: string }>();
  return p.orgId;
}

/** GET an org-scoped resource: path is relative to /orgs/:orgId. */
export function useOrgQuery<T>(path: string | null, opts: Partial<UseQueryOptions<T, ApiError>> = {}) {
  const orgId = useOrgId();
  return useQuery<T, ApiError>({
    queryKey: ['org', orgId, path] as QueryKey,
    queryFn: ({ signal }) => api<T>(`/orgs/${orgId}${path}`, { signal }),
    enabled: !!path && !!orgId,
    ...opts,
  });
}

/**
 * Refresh org queries after a change. With `prefixes`, only queries whose path starts with one of
 * them refetch (e.g. ['/tracking', '/time-entries']); without, every org query does.
 */
export function invalidateOrg(qc: QueryClient, orgId: string, prefixes?: string[]) {
  if (!prefixes) return qc.invalidateQueries({ queryKey: ['org', orgId] });
  return qc.invalidateQueries({ queryKey: ['org', orgId], predicate: (q) => typeof q.queryKey[2] === 'string' && prefixes.some((p) => (q.queryKey[2] as string).startsWith(p)) });
}

/**
 * Mutations against /orgs/:orgId. On success they refresh all org queries, or only the path
 * prefixes given in `invalidate` (false: none).
 */
export function useOrgMutation<TBody = unknown, TRes = unknown>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string | ((b: TBody) => string), opts: { invalidate?: boolean | string[]; onSuccess?: (r: TRes, b: TBody) => void } = {}) {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return useMutation<TRes, ApiError, TBody>({
    mutationFn: (b) => api<TRes>(`/orgs/${orgId}${typeof path === 'function' ? path(b) : path}`, { method, body: method === 'DELETE' && (b === undefined || b === null) ? undefined : (b ?? {}) }),
    onSuccess: (r, b) => {
      if (opts.invalidate !== false) void invalidateOrg(qc, orgId, Array.isArray(opts.invalidate) ? opts.invalidate : undefined);
      opts.onSuccess?.(r, b);
    },
  });
}

export function qs(params: Record<string, string | number | boolean | string[] | null | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) u.set(k, v.join(','));
    } else u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.title;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}
