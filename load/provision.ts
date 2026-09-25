/**
 * Creates a load-test organization with N members, each with a registered desktop device, and
 * writes their device tokens to load/tokens.json for the k6 scripts.
 *
 *   BASE_URL=https://staging.example.com AGENTS=1000 CONCURRENCY=20 pnpm dlx tsx load/provision.ts
 *
 * Run against staging only: it creates real accounts. Signup email verification must be off
 * there (REQUIRE_EMAIL_VERIFICATION unset).
 */
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '') + '/api/v1';
const N = Number(process.env.AGENTS ?? 100);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const PASSWORD = `load-${randomBytes(6).toString('hex')}-Aa1!`;
const run = randomBytes(3).toString('hex');

async function call(method: string, path: string, body?: unknown, cookie?: string, bearer?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: new URL(BASE).origin, ...(cookie ? { Cookie: cookie } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  const setCookie = res.headers.get('set-cookie')?.match(/tw_session=([^;]+)/)?.[1];
  return { body: text ? JSON.parse(text) : null, cookie: setCookie ? `tw_session=${setCookie}` : cookie };
}

async function main() {
  const admin = await call('POST', '/auth/signup', { name: 'Load Admin', email: `load-admin-${run}@load.test`, password: PASSWORD, organization_name: `Load test ${run}`, timezone: 'UTC' });
  const orgId = admin.body.organization_id as string;
  const cookie = admin.cookie!;
  const roles = (await call('GET', `/orgs/${orgId}/roles`, undefined, cookie)).body as Array<{ id: string; key: string }>;
  const worker = roles.find((r) => r.key === 'WORKER')!.id;
  const project = (await call('POST', `/orgs/${orgId}/projects`, { name: 'Load project' }, cookie)).body.id as string;

  const tokens: Array<{ access_token: string; refresh_token: string; project_id: string; membership_id: string }> = [];
  let next = 0;
  async function one(i: number) {
    const email = `load-${run}-${i}@load.test`;
    const inv = await call('POST', `/orgs/${orgId}/invitations`, { email, name: `Agent ${i}`, role_id: worker }, cookie);
    const token = new URL(inv.body.invite_url).searchParams.get('token');
    const acc = await call('POST', '/auth/invitations/accept', { token, name: `Agent ${i}`, password: PASSWORD });
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const code = await call('POST', '/agent/authorize', { code_challenge: challenge, organization_id: orgId }, acc.cookie);
    const reg = await call('POST', '/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: `Load PC ${i}`, platform: 'linux', agent_version: '0.1.0' } });
    tokens.push({ access_token: reg.body.access_token, refresh_token: reg.body.refresh_token, project_id: project, membership_id: acc.body.membership_id });
  }
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < N) {
        const i = next++;
        await one(i);
        if (tokens.length % 100 === 0) console.log(`${tokens.length}/${N}`);
      }
    }),
  );
  await call('PATCH', `/orgs/${orgId}/projects/${project}`, { member_ids: tokens.map((t) => t.membership_id) }, cookie);
  writeFileSync(new URL('./tokens.json', import.meta.url), JSON.stringify({ base_url: BASE, org_id: orgId, admin_email: `load-admin-${run}@load.test`, admin_password: PASSWORD, agents: tokens }, null, 1));
  console.log(`Provisioned ${tokens.length} agents in org ${orgId}. Tokens in load/tokens.json (keep it private; it contains credentials).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
