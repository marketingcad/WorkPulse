import { app, net, shell } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import type { AgentApi } from './api';

const LOGIN_TIMEOUT_MS = 5 * 60_000;

function platform(): 'windows' | 'macos' | 'linux' {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
}

/**
 * Desktop sign-in with OAuth-style PKCE through the system browser:
 * 1. start a one-shot loopback server on 127.0.0.1:<random port>
 * 2. open <server>/device/authorize?code_challenge&redirect_uri&state in the browser
 * 3. the signed-in web page redirects back with a one-time code
 * 4. exchange code + verifier for device credentials (POST /agent/register)
 * Passwords never touch the desktop app.
 */
export async function signIn(api: AgentApi, serverUrl: string, capabilities: Record<string, boolean>): Promise<void> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');

  let server: Server | null = null;
  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Sign-in timed out. Please try again.')), LOGIN_TIMEOUT_MS);
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const ok = url.searchParams.get('state') === state && !!url.searchParams.get('code');
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Tallywork</title><body style="font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f6f7f9;color:#141a23"><div style="text-align:center"><h2>${ok ? 'You are signed in' : 'Sign-in failed'}</h2><p>${ok ? 'You can close this tab and return to the Tallywork app.' : 'Please try again from the app.'}</p></div></body>`,
      );
      clearTimeout(timer);
      if (ok) resolve(url.searchParams.get('code')!);
      else reject(new Error('Sign-in was not completed (state mismatch).'));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const redirect = `http://127.0.0.1:${port}/callback`;
      const authUrl = `${serverUrl}/device/authorize?code_challenge=${encodeURIComponent(challenge)}&redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}`;
      void shell.openExternal(authUrl);
    });
    server.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  }).finally(() => (server as Server | null)?.close());

  const res = await net.fetch(`${serverUrl}/api/v1/agent/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      device: {
        name: `${os.hostname()}`.slice(0, 100),
        platform: platform(),
        os_version: `${os.type()} ${os.release()}`.slice(0, 100),
        agent_version: app.getVersion(),
        capabilities,
      },
    }),
  });
  if (!res.ok) {
    const p = (await res.json().catch(() => ({}))) as { title?: string };
    throw new Error(p.title ?? `Registration failed (${res.status})`);
  }
  const r = (await res.json()) as { device_id: string; organization_id: string; access_token: string; refresh_token: string; expires_in: number };
  api.saveCredentials({ deviceId: r.device_id, organizationId: r.organization_id, refreshToken: r.refresh_token, serverUrl }, { token: r.access_token, expiresIn: r.expires_in });
}
