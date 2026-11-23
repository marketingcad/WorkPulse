import { request, type APIRequestContext } from '@playwright/test';
import { ok } from './fixtures';
import { PASSWORD, WEB_URL } from './env';
import { inviteeAddress } from './invitee';

/** Invite a new Worker through the API and accept the invitation; returns their membership id. */
export async function invitePerson(adminApi: { api: APIRequestContext; orgApi: (p: string) => string }, email: string, name: string): Promise<string> {
  const roles = await ok<Array<{ id: string; key: string }>>(await adminApi.api.get(adminApi.orgApi('/roles')), 'roles');
  const invite = await ok<{ invite_url: string }>(await adminApi.api.post(adminApi.orgApi('/invitations'), { data: { email, name, role_id: roles.find((r) => r.key === 'WORKER')!.id } }), 'invite');
  // Signed out: inside a test, a new request context would otherwise reuse the file's admin session.
  const ctx = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL, ...inviteeAddress() }, storageState: { cookies: [], origins: [] } });
  const accepted = await ok<{ membership_id: string }>(await ctx.post('/api/v1/auth/invitations/accept', { data: { token: new URL(invite.invite_url).searchParams.get('token'), name, password: PASSWORD } }), 'accept');
  await ctx.dispose();
  return accepted.membership_id;
}
