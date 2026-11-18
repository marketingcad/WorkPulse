import { beforeEach, describe, expect, it, vi } from 'vitest';

// A computer set up by IT carries an enrollment token in its managed settings. The app sends it with
// the sign-in (email + password or browser), only when one is set, and never shows it: the renderer
// only learns that the computer is managed.
const TOKEN = `wpe_${'Q'.repeat(43)}`;
const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
const disk = new Map<string, unknown>();

vi.mock('electron', () => ({
  app: { getVersion: () => '0.3.0' },
  shell: { openExternal: vi.fn() },
  net: {
    fetch: async (url: string, init: { body: string }) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 201, json: async () => ({ device_id: 'd', organization_id: 'org', access_token: 'a', refresh_token: 'r', expires_in: 600 }) };
    },
  },
  Notification: class {
    show() {}
  },
  powerMonitor: { on: () => undefined },
  desktopCapturer: {},
  nativeImage: {},
  screen: {},
  systemPreferences: {},
}));
vi.mock('../src/main/services/secure-store', () => ({
  SecureStore: class {
    readJson = (name: string) => (disk.has(name) ? structuredClone(disk.get(name)) : null);
    writeJson = (name: string, value: unknown) => void disk.set(name, structuredClone(value));
  },
}));
const saved: unknown[] = [];
vi.mock('../src/main/services/api', () => ({
  ApiError: class extends Error {},
  AgentApi: class {
    serverUrl = null;
    onSignedOut = () => undefined;
    signed = false;
    get signedIn() {
      return this.signed;
    }
    saveCredentials(c: unknown) {
      saved.push(c);
      this.signed = true;
    }
    clear() {}
    async request(_method: string, path: string) {
      if (path === '/agent/bootstrap') throw new Error('offline in this test');
      throw new Error(`unexpected ${path}`);
    }
  },
}));
vi.mock('../src/main/services/queue', () => ({
  queueFileFor: (account: string | null) => (account ? `queue-${account}` : 'queue'),
  OfflineQueue: class {
    static adoptLegacy() {}
    full = false;
    events: unknown[] = [];
    size = 0;
    push() {}
    peek() {
      return [];
    }
    some() {
      return false;
    }
    ack() {}
  },
}));

const { Agent } = await import('../src/main/services/agent');

function newAgent(token: string | null) {
  const agent = new Agent('http://127.0.0.1:3100', '0.3.0', null, token);
  const a = agent as unknown as Record<string, unknown>;
  a.startMonitors = vi.fn();
  a.stopMonitors = vi.fn();
  a.flushObservations = vi.fn();
  a.emitState = vi.fn();
  return agent;
}

beforeEach(() => {
  requests.length = 0;
  saved.length = 0;
  disk.clear();
});

describe('enrollment token at sign-in', () => {
  it('a managed computer sends its token with the email and password sign-in', async () => {
    const agent = newAgent(TOKEN);
    await agent.loginWithPassword({ email: 'walt@acme.test', password: 'pw' });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('http://127.0.0.1:3100/api/v1/agent/login');
    expect(requests[0]!.body).toMatchObject({ email: 'walt@acme.test', enrollment_token: TOKEN });
    // Only device tokens are kept; the enrollment token is not saved with them.
    expect(JSON.stringify(saved)).not.toContain(TOKEN);
  });

  it('an ordinary computer sends no token', async () => {
    const agent = newAgent(null);
    await agent.loginWithPassword({ email: 'walt@acme.test', password: 'pw' });
    expect(requests[0]!.body).not.toHaveProperty('enrollment_token');
  });

  it('the renderer learns only that the computer is managed, never the token', () => {
    const managed = newAgent(TOKEN).state();
    expect(managed.enrollmentManaged).toBe(true);
    expect(JSON.stringify(managed)).not.toContain(TOKEN);
    expect(JSON.stringify(managed)).not.toContain(TOKEN.slice(4, 20));
    expect(newAgent(null).state().enrollmentManaged).toBe(false);
  });

  it('nothing the app writes to disk contains the token', async () => {
    const agent = newAgent(TOKEN);
    await agent.loginWithPassword({ email: 'walt@acme.test', password: 'pw' });
    expect(JSON.stringify([...disk.entries()])).not.toContain(TOKEN);
  });
});

describe('browser sign-in request', () => {
  it('sends the token with the code exchange when the computer is managed', async () => {
    const { signIn } = await import('../src/main/services/auth');
    const http = await import('node:http');
    // The loopback server: answer its callback the way the browser would, with the right state.
    const open = (await import('electron')).shell.openExternal as unknown as ReturnType<typeof vi.fn>;
    open.mockImplementation(async (url: string) => {
      const u = new URL(url);
      const back = new URL(u.searchParams.get('redirect_uri')!);
      back.searchParams.set('code', 'c'.repeat(30));
      back.searchParams.set('state', u.searchParams.get('state')!);
      await new Promise<void>((resolve) => http.get(back, (res) => (res.resume(), res.on('end', () => resolve()))));
    });
    const api = { saveCredentials: vi.fn() } as never;
    await signIn(api, 'http://127.0.0.1:3100', {}, TOKEN);
    const reg = requests.find((r) => r.url.endsWith('/agent/register'))!;
    expect(reg.body).toMatchObject({ enrollment_token: TOKEN });
    requests.length = 0;
    await signIn(api, 'http://127.0.0.1:3100', {});
    expect(requests.find((r) => r.url.endsWith('/agent/register'))!.body).not.toHaveProperty('enrollment_token');
  });
});
