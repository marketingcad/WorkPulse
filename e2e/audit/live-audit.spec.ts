import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { request, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { expect, ok, test, uid } from '../support/fixtures';
import { ADMIN_STATE, PASSWORD, VIEWER_STATE, WEB_URL, WORKER_STATE } from '../support/env';

/**
 * Live browser audit: every page of the workspace, opened in a real browser as each kind of user,
 * watched for what a person would hit: console errors, crashes, failed or 5xx requests, broken images,
 * sideways scrolling, and serious accessibility problems. Then the pages a role must NOT reach are
 * opened directly. Findings go to test-results/live-audit/<role>.json, with screenshots of failures.
 */
const ROUTES = [
  '', '/activity', '/attendance', '/clients', '/developer/api-keys', '/developer/webhooks', '/devices', '/finance/billing', '/finance/budgets',
  '/finance/expenses', '/finance/invoices', '/finance/invoices/payments', '/finance/payroll', '/help', '/insights', '/me/monitoring', '/me/profile', '/pay-stubs',
  '/performance', '/performance/achievements', '/performance/goals', '/performance/leaderboards', '/performance/teams', '/performance/workers', '/projects',
  '/reports', '/schedules', '/sessions', '/settings', '/settings/access-review', '/settings/audit', '/settings/policies', '/settings/roles',
  '/settings/screenshot-retention', '/settings/security', '/settings/time', '/tasks', '/teams', '/time-off', '/timesheets', '/timesheets/all',
  '/timesheets/approvals', '/timesheets/not-added', '/timesheets/team', '/tracking/live', '/tracking/reports', '/workers',
];
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.tmp/live-audit');
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, laptop: { width: 1280, height: 800 }, tablet: { width: 834, height: 1112 }, phone: { width: 390, height: 844 } };
const DENIED = 'You don’t have access to this area.';

type Finding = { route: string; view: string; kind: string; detail: string };
const findings: Record<string, Finding[]> = {};
const visited: Record<string, number> = {};

function record(role: string, f: Finding) {
  (findings[role] ??= []).push(f);
}

/** Watches one page for everything a person would notice going wrong. */
function watch(page: Page) {
  const seen = { console: [] as Array<{ text: string; path: string }>, crashes: [] as string[], failed: [] as string[], api: [] as string[] };
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    let p = '';
    try {
      p = new URL(m.location().url).pathname;
    } catch {
      /* no source URL */
    }
    seen.console.push({ text: m.text().slice(0, 300), path: p });
  });
  page.on('pageerror', (e) => seen.crashes.push(String(e.message).slice(0, 300)));
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText ?? '';
    if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(why)) seen.failed.push(`${r.method()} ${new URL(r.url()).pathname} ${why}`);
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.origin === WEB_URL && u.pathname.startsWith('/api/') && r.status() >= 400) seen.api.push(`${r.status()} ${r.request().method()} ${u.pathname}`);
  });
  return seen;
}

async function settle(page: Page) {
  await page.locator('main, [role="main"]').first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.querySelector('main [aria-busy="true"]'), undefined, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
}

async function audit(role: string, page: Page, url: string, view: string, opts: { axe?: boolean; shot?: boolean; allowApi?: RegExp } = {}) {
  const seen = watch(page);
  await page.goto(url);
  await settle(page);
  visited[role] = (visited[role] ?? 0) + 1;
  const where = { route: url.replace(/^\/o\/[^/]+/, '') || '/', view };
  for (const c of seen.crashes) record(role, { ...where, kind: 'page error', detail: c });
  // The browser logs every refused request as "Failed to load resource"; when that refusal is one the
  // page is expected to get (allowApi), it is the same event as the API line, not a separate fault.
  const allowed = seen.api.filter((a) => opts.allowApi?.test(a));
  for (const c of seen.console) {
    const expectedRefusal = c.text.startsWith('Failed to load resource') && allowed.some((a) => a.endsWith(` ${c.path}`));
    if (!expectedRefusal) record(role, { ...where, kind: 'console error', detail: c.path ? `${c.text} (${c.path})` : c.text });
  }
  for (const f of seen.failed) record(role, { ...where, kind: 'failed request', detail: f });
  for (const a of seen.api) if (!opts.allowApi?.test(a)) record(role, { ...where, kind: 'API error', detail: a });
  const broken = await page.evaluate(() => Array.from(document.images).filter((i) => i.complete && i.src && i.naturalWidth === 0).map((i) => i.src.slice(0, 120)));
  for (const b of broken) record(role, { ...where, kind: 'broken image', detail: b });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) record(role, { ...where, kind: 'sideways scroll', detail: `${overflow}px wider than the screen` });
  if (opts.axe) {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) record(role, { ...where, kind: 'accessibility', detail: `${v.id}: ${v.help} (${v.nodes[0]?.target.join(' ')})` });
  }
  const failed = (findings[role] ?? []).some((f) => f.route === where.route && f.view === view);
  if (opts.shot || failed) {
    // Kept with the findings (e2e/.tmp/live-audit/screens) as the evidence for the run.
    const file = path.join(OUT, 'screens', `${role}-${view}-${where.route.replace(/\W+/g, '_') || 'home'}.png`);
    await page.screenshot({ path: file, fullPage: false });
  }
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.removeAllListeners('requestfailed');
  page.removeAllListeners('response');
}

function save(role: string) {
  const dir = OUT;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${role}.json`), JSON.stringify({ role, pages_opened: visited[role] ?? 0, findings: findings[role] ?? [] }, null, 2));
}

async function contextFor(browser: Browser, storageState: string | Awaited<ReturnType<Awaited<ReturnType<typeof request.newContext>>['storageState']>>, viewport = VIEWPORTS.desktop, colorScheme: 'light' | 'dark' = 'light'): Promise<BrowserContext> {
  return browser.newContext({ storageState, viewport, colorScheme });
}

test.describe.configure({ mode: 'parallel' });
test.setTimeout(15 * 60_000);

test('admin: every page, at desktop, laptop, tablet and phone sizes, and in dark mode', async ({ browser, data }) => {
  for (const [view, viewport] of Object.entries(VIEWPORTS)) {
    const ctx = await contextFor(browser, ADMIN_STATE, viewport);
    const page = await ctx.newPage();
    for (const r of ROUTES) await audit('admin', page, `/o/${data.orgId}${r}`, view, { axe: view === 'desktop', shot: view === 'desktop' && ['', '/timesheets/approvals', '/finance/invoices', '/performance'].includes(r) });
    await ctx.close();
  }
  const dark = await contextFor(browser, ADMIN_STATE, VIEWPORTS.desktop, 'dark');
  const page = await dark.newPage();
  for (const r of ROUTES) await audit('admin', page, `/o/${data.orgId}${r}`, 'desktop-dark', { axe: true, shot: ['', '/finance/invoices'].includes(r) });
  await dark.close();
  save('admin');
  expect.soft(findings.admin ?? [], 'admin findings').toEqual([]);
});

test('team manager: their pages open, money and administration are refused', async ({ browser, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  const roles = await ok<Array<{ id: string; key: string }>>(await api.get(orgApi('/roles')), 'roles');
  const teams = await ok<Array<{ id: string; name: string }>>(await api.get(orgApi('/teams')), 'teams');
  const team = teams.find((t) => t.name === data.teamName)!;
  const inv = await ok<{ invite_url: string }>(await api.post(orgApi('/invitations'), { data: { email: `mona+${uid()}@e2e.test`, name: 'Mona Manager', role_id: roles.find((r) => r.key === 'TEAM_MANAGER')!.id, team_ids: [team.id], team_role: 'MANAGER' } }), 'invite manager');
  const mApi = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL } });
  await ok(await mApi.post('/api/v1/auth/invitations/accept', { data: { token: new URL(inv.invite_url).searchParams.get('token'), name: 'Mona Manager', password: PASSWORD } }), 'accept');
  await mApi.patch('/api/v1/me', { data: { tour: 'done' } });
  const ctx = await contextFor(browser, await mApi.storageState());
  const page = await ctx.newPage();

  const allowed = ['', '/activity', '/attendance', '/timesheets/approvals', '/timesheets/team', '/tracking/live', '/time-off', '/schedules', '/performance', '/performance/teams', '/performance/workers', '/projects', '/tasks', '/teams', '/help'];
  for (const r of allowed) {
    await audit('manager', page, `/o/${data.orgId}${r}`, 'desktop', { axe: true });
    await expect.soft(page.getByText(DENIED), `manager should open ${r || '/'}`).toHaveCount(0);
  }
  // Money and administration: denied on the page, refused by the API.
  for (const r of ['/finance/invoices', '/finance/payroll', '/finance/billing', '/settings/roles', '/settings/security', '/developer/api-keys', '/settings/audit']) {
    await audit('manager', page, `/o/${data.orgId}${r}`, 'restricted', { allowApi: /^40[34] / });
    await expect.soft(page.getByText(DENIED), `manager must be refused ${r}`).toBeVisible();
  }
  for (const p of ['/invoices', '/payroll/runs', '/rates', '/api-keys', '/audit-logs']) expect.soft((await mApi.get(`/api/v1/orgs/${data.orgId}${p}`)).status(), `API ${p}`).toBe(403);
  await ctx.close();
  await mApi.dispose();
  save('manager');
  expect.soft(findings.manager ?? [], 'manager findings').toEqual([]);
});

test('worker: the web workspace sends them to the desktop app download, for every page', async ({ browser, data }) => {
  const ctx = await contextFor(browser, WORKER_STATE);
  const page = await ctx.newPage();
  for (const r of ['', '/timesheets', '/finance/invoices', '/workers', '/settings', '/performance']) {
    await audit('worker', page, `/o/${data.orgId}${r}`, 'desktop', { allowApi: /^40[34] / });
    await expect.soft(page, `worker opening ${r || '/'}`).toHaveURL(/\/download/);
  }
  await audit('worker', page, '/download', 'desktop', { axe: true, shot: true });
  await expect.soft(page.getByRole('heading', { level: 1 })).toBeVisible();
  await ctx.close();
  save('worker');
  expect.soft(findings.worker ?? [], 'worker findings').toEqual([]);
});

test('custom role (budget viewer): only what the role grants opens', async ({ browser, data }) => {
  const ctx = await contextFor(browser, VIEWER_STATE);
  const page = await ctx.newPage();
  await audit('custom-role', page, `/o/${data.orgId}/finance/budgets`, 'desktop', { axe: true, shot: true });
  await expect.soft(page.getByText(DENIED)).toHaveCount(0);
  for (const r of ['/finance/invoices', '/finance/payroll', '/settings/roles', '/performance', '/timesheets/approvals']) {
    await audit('custom-role', page, `/o/${data.orgId}${r}`, 'restricted', { allowApi: /^40[34] / });
    // Refused, in the generic words or the page's own ("Approvals need the … approval permission.").
    await expect.soft(page.getByText(/You don’t have access to this area\.|need the .* permission/).first(), `custom role must be refused ${r}`).toBeVisible();
  }
  // members:read for its own record: the Members page opens (the sidebar hides it) but lists only them.
  await audit('custom-role', page, `/o/${data.orgId}/workers`, 'own-scope');
  await expect.soft(page.getByText(data.admin.name), 'no other member is listed').toHaveCount(0);
  await expect.soft(page.getByText(data.worker.name), 'no other member is listed').toHaveCount(0);
  await ctx.close();
  save('custom-role');
  expect.soft(findings['custom-role'] ?? [], 'custom role findings').toEqual([]);
});

test('client viewer: their portal opens; the organization’s workspace and money stay closed', async ({ browser, data, adminApi }) => {
  const { api, orgApi } = adminApi;
  const client = await ok<{ id: string }>(await api.post(orgApi('/clients'), { data: { name: `Audit Client ${uid()}` } }), 'client');
  await ok(await api.post(orgApi('/projects'), { data: { name: `Audit Project ${uid()}`, client_id: client.id, member_ids: [data.worker.membershipId] } }), 'project');
  await ok(await api.put(orgApi(`/clients/${client.id}/portal`), { data: { enabled: true, sections: { hours: true, tasks: true, activity: false, screenshots: false } } }), 'portal');
  const inv = await ok<{ invite_url: string }>(await api.post(orgApi(`/clients/${client.id}/portal/invitations`), { data: { email: `cleo+${uid()}@e2e.test`, name: 'Cleo Client' } }), 'portal invite');
  const cApi = await request.newContext({ baseURL: WEB_URL, extraHTTPHeaders: { Origin: WEB_URL } });
  const accepted = await ok<{ access_id: string }>(await cApi.post('/api/v1/portal/invitations/accept', { data: { token: new URL(inv.invite_url).searchParams.get('token'), name: 'Cleo Client', password: PASSWORD } }), 'portal accept');
  for (const [view, viewport] of Object.entries(VIEWPORTS)) {
    const ctx = await contextFor(browser, await cApi.storageState(), viewport);
    const page = await ctx.newPage();
    await audit('client-viewer', page, `/portal/${accepted.access_id}`, view, { axe: view === 'desktop', shot: view === 'desktop' || view === 'phone' });
    await expect.soft(page.getByRole('heading', { level: 1 })).toBeVisible();
    await ctx.close();
  }
  // The workspace is not theirs: no organization pages, no money.
  const ctx = await contextFor(browser, await cApi.storageState());
  const page = await ctx.newPage();
  for (const r of ['', '/finance/invoices', '/finance/payroll', '/workers']) {
    await audit('client-viewer', page, `/o/${data.orgId}${r}`, 'restricted', { allowApi: /^40[134] / });
    await expect.soft(page.getByRole('heading', { name: /Invoices|Payroll|Members/ })).toHaveCount(0);
  }
  for (const p of ['/invoices', '/payroll/runs', '/rates', '/workers']) expect.soft([401, 403, 404], `client API ${p}`).toContain((await cApi.get(`/api/v1/orgs/${data.orgId}${p}`)).status());
  await ctx.close();
  await cApi.dispose();
  save('client-viewer');
  expect.soft(findings['client-viewer'] ?? [], 'client viewer findings').toEqual([]);
});

test('support console: a plain "page not found" for anyone who is not staff', async ({ browser }) => {
  const ctx = await contextFor(browser, ADMIN_STATE);
  const page = await ctx.newPage();
  await audit('support', page, '/support', 'desktop', { allowApi: /^404 GET \/api\/v1\/support\/me$/, shot: true });
  await expect.soft(page.getByText('Page not found')).toBeVisible();
  await ctx.close();
  save('support');
  expect.soft(findings.support ?? [], 'support findings').toEqual([]);
});

test('browser and version', async ({ browser }) => {
  const dir = OUT;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'browser.json'), JSON.stringify({ browser: browser.browserType().name(), version: browser.version() }));
});
