import { net } from 'electron';
import type { SecureStore } from './secure-store';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Credentials {
  deviceId: string;
  organizationId: string;
  refreshToken: string;
  serverUrl: string;
}

/**
 * Minimal authenticated client for the /api/v1/agent endpoints.
 * Access tokens live only in memory (10 min); the rotating refresh token is
 * stored encrypted. Every request uses Electron's net stack (system proxy/certs).
 */
export class AgentApi {
  private access: { token: string; exp: number } | null = null;
  private creds: Credentials | null;
  private refreshing: Promise<void> | null = null;
  onSignedOut: (reason: string) => void = () => undefined;

  constructor(private readonly store: SecureStore) {
    this.creds = store.readJson<Credentials>('credentials');
  }

  get signedIn(): boolean {
    return !!this.creds;
  }

  get serverUrl(): string | null {
    return this.creds?.serverUrl ?? null;
  }

  get deviceId(): string | null {
    return this.creds?.deviceId ?? null;
  }

  saveCredentials(c: Credentials, access?: { token: string; expiresIn: number }): void {
    this.creds = c;
    this.store.writeJson('credentials', c);
    if (access) this.access = { token: access.token, exp: Date.now() + (access.expiresIn - 30) * 1000 };
  }

  clear(): void {
    this.creds = null;
    this.access = null;
    this.store.writeJson('credentials', null);
  }

  private async refresh(): Promise<void> {
    if (!this.creds) throw new ApiError(401, 'signed_out', 'Not signed in');
    const res = await net.fetch(`${this.creds.serverUrl}/api/v1/agent/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.creds.refreshToken }),
    });
    if (res.status === 401) {
      const body = (await res.json().catch(() => ({}))) as { code?: string; title?: string };
      this.clear();
      this.onSignedOut(body.code === 'device_revoked' ? 'This device was revoked by your administrator.' : 'Your session expired. Please sign in again.');
      throw new ApiError(401, body.code ?? 'unauthenticated', body.title ?? 'Signed out');
    }
    if (!res.ok) throw new ApiError(res.status, 'refresh_failed', `Token refresh failed (${res.status})`);
    const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
    this.saveCredentials({ ...this.creds, refreshToken: t.refresh_token }, { token: t.access_token, expiresIn: t.expires_in });
  }

  private async token(): Promise<string> {
    if (!this.access || this.access.exp < Date.now()) {
      this.refreshing ??= this.refresh().finally(() => (this.refreshing = null));
      await this.refreshing;
    }
    return this.access!.token;
  }

  async request<T>(method: string, path: string, body?: unknown, raw?: { data: Buffer; contentType: string }): Promise<T> {
    if (!this.creds) throw new ApiError(401, 'signed_out', 'Not signed in');
    const send = async () =>
      net.fetch(`${this.creds!.serverUrl}/api/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          ...(raw ? { 'Content-Type': raw.contentType } : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          'User-Agent': `TallyworkDesktop/${process.env.npm_package_version ?? '0.1.0'}`,
        },
        body: raw ? new Uint8Array(raw.data) : body !== undefined ? JSON.stringify(body) : undefined,
      });
    let res = await send();
    if (res.status === 401) {
      this.access = null;
      res = await send();
    }
    if (!res.ok) {
      const p = (await res.json().catch(() => ({}))) as { code?: string; title?: string };
      if (res.status === 401) {
        this.clear();
        this.onSignedOut(p.title ?? 'Signed out');
      }
      throw new ApiError(res.status, p.code ?? 'error', p.title ?? `Request failed (${res.status})`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
