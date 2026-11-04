import { mkdirSync, writeFileSync } from 'node:fs';
import { request, type APIRequestContext } from '@playwright/test';
import type { MeDto } from '@tallywork/contracts';
import { DEMO_PASSWORD, PEOPLE, STATE, TUTORIAL_AUTH_DIR, TUTORIAL_DATA, TUTORIAL_URL } from './env';

/** What the scenes need to know about the seeded demo workspace. */
export interface TutorialData {
  orgId: string;
  orgName: string;
}

async function json<T = any>(res: Awaited<ReturnType<APIRequestContext['get']>>, what: string): Promise<T> {
  if (!res.ok()) throw new Error(`[tutorial setup] ${what}: HTTP ${res.status()} ${await res.text()}`);
  return (res.status() === 204 ? undefined : await res.json()) as T;
}

/**
 * Signs the admin and the team manager in once (sign-in is rate-limited, as in production) and
 * marks the product tour as seen, so it only appears in the scene that restarts it from Help.
 */
export default async function setup(): Promise<void> {
  const host = new URL(TUTORIAL_URL).hostname;
  if (!['localhost', '127.0.0.1'].includes(host)) throw new Error(`[tutorial setup] refusing to record against ${TUTORIAL_URL}: only a local demo server`);

  mkdirSync(TUTORIAL_AUTH_DIR, { recursive: true });
  let data: TutorialData | null = null;
  for (const who of ['admin', 'manager'] as const) {
    const ctx = await request.newContext({ baseURL: TUTORIAL_URL, extraHTTPHeaders: { Origin: TUTORIAL_URL } });
    await json(await ctx.post('/api/v1/auth/login', { data: { email: PEOPLE[who].email, password: DEMO_PASSWORD } }), `sign in ${who}`);
    const me = await json<MeDto>(await ctx.get('/api/v1/me'), 'me');
    const org = me.organizations[0];
    if (!org) throw new Error(`[tutorial setup] ${who} belongs to no organization`);
    const orgId = org.id;
    data ??= { orgId, orgName: org.name };
    await json(await ctx.patch('/api/v1/me', { data: { tour: 'done' } }), 'tour seen');
    const state = await ctx.storageState();
    state.origins = [{ origin: TUTORIAL_URL, localStorage: [{ name: 'tw.lastOrg', value: orgId }] }];
    writeFileSync(STATE[who], JSON.stringify(state));
    await ctx.dispose();
  }
  writeFileSync(TUTORIAL_DATA, JSON.stringify(data, null, 2));
}
