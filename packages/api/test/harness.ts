import { createHash, randomBytes } from 'node:crypto';
import { createDb, type DbHandle } from '@tallywork/db/client';
import { createApp } from '../src/app';
import type { Deps } from '../src/context';
import { loadConfig } from '../src/config';
import { MemoryMailer } from '../src/lib/mailer';
import { MemoryStorage } from '../src/lib/storage';
import { dispatchOutbox } from '../src/jobs';

export interface Harness {
  h: DbHandle;
  deps: Deps;
  app: ReturnType<typeof createApp>;
  mailer: MemoryMailer;
  storage: MemoryStorage;
  clock: { now: Date; advance(ms: number): void; set(d: Date): void };
  flush(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const h = createDb('pglite://memory');
  await h.migrate();
  const mailer = new MemoryMailer();
  const storage = new MemoryStorage();
  const clock = {
    now: new Date(),
    advance(ms: number) {
      this.now = new Date(this.now.getTime() + ms);
    },
    set(d: Date) {
      this.now = d;
    },
  };
  const deferred: Array<() => Promise<void>> = [];
  const deps: Deps = {
    db: h.db,
    config: { ...loadConfig({ NODE_ENV: 'test', APP_URL: 'http://localhost:3000' }), cronSecret: 'cron-secret' },
    storage,
    mailer,
    defer: (t) => {
      deferred.push(t);
    },
    now: () => clock.now,
  };
  const app = createApp(deps);
  return {
    h,
    deps,
    app,
    mailer,
    storage,
    clock,
    async flush() {
      deferred.length = 0;
      await dispatchOutbox(deps, 1000);
    },
    close: () => h.close(),
  };
}

/** A cookie-keeping HTTP client for one user (or a bearer token). */
export class Client {
  cookie = '';
  bearer = '';
  constructor(private readonly t: Harness) {}

  async req<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T; headers: Headers }> {
    const res = await this.t.app.request(`/api/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        Origin: 'http://localhost:3000',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(this.bearer ? { Authorization: `Bearer ${this.bearer}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? (body as never) : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = setCookie.match(/tw_session=([^;]*)/);
      if (m) this.cookie = m[1] ? `tw_session=${m[1]}` : '';
    }
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON */
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = any>(path: string) {
    return this.req<T>('GET', path);
  }
  post<T = any>(path: string, body: unknown = {}) {
    return this.req<T>('POST', path, body);
  }
  patch<T = any>(path: string, body: unknown) {
    return this.req<T>('PATCH', path, body);
  }
  put<T = any>(path: string, body: unknown) {
    return this.req<T>('PUT', path, body);
  }
  del<T = any>(path: string) {
    return this.req<T>('DELETE', path);
  }
}

export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export async function signup(t: Harness, name: string, email: string, org = `${name}'s Org`) {
  const c = new Client(t);
  const r = await c.post('/auth/signup', { name, email, password: 'correct-horse-battery', organization_name: org, timezone: 'America/New_York' });
  if (r.status !== 201) throw new Error(`signup failed ${r.status} ${JSON.stringify(r.body)}`);
  return { client: c, orgId: (r.body as { organization_id: string }).organization_id };
}

/** Invite + accept; returns the new member's client and membership id. */
export async function addMember(t: Harness, admin: Client, orgId: string, name: string, email: string, roleKey: 'WORKER' | 'TEAM_MANAGER' | 'SYSTEM_ADMIN' = 'WORKER') {
  const roles = await admin.get<Array<{ id: string; key: string }>>(`/orgs/${orgId}/roles`);
  const role = roles.body.find((r) => r.key === roleKey)!;
  const inv = await admin.post(`/orgs/${orgId}/invitations`, { email, name, role_id: role.id });
  if (inv.status !== 201) throw new Error(`invite failed ${JSON.stringify(inv.body)}`);
  const token = new URL((inv.body as { invite_url: string }).invite_url).searchParams.get('token')!;
  const c = new Client(t);
  const acc = await c.post('/auth/invitations/accept', { token, name, password: 'correct-horse-battery' });
  if (acc.status !== 200) throw new Error(`accept failed ${JSON.stringify(acc.body)}`);
  return { client: c, membershipId: (acc.body as { membership_id: string }).membership_id };
}
