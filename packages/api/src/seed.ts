import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { organizations, withSystem } from '@tallywork/db';
import { addDaysToDate, dayOfWeek, localDate, newId, zonedWallTimeToUtc } from '@tallywork/domain';
import { createApp } from './app';
import type { Deps } from './context';
import { dispatchOutbox } from './jobs';

/**
 * Realistic demo workspace, created exclusively through the public API with a
 * controllable clock — the same code paths as real usage (agent ingest, approvals…).
 * Everything is labelled as demo data.
 */

export const DEMO_ADMIN = { email: 'admin@demo.tallywork.app', password: 'demo-password-123', name: 'Avery Admin' };

const FIRST = ['Maya', 'Liam', 'Sofia', 'Noah', 'Ava', 'Ethan', 'Isla', 'Lucas', 'Zara', 'Omar', 'Priya', 'Mateo', 'Chloe', 'Kenji', 'Amara', 'Diego', 'Hana', 'Felix', 'Nia', 'Arjun', 'Elena', 'Tomas', 'Leila', 'Ravi', 'Grace', 'Jonah', 'Mina', 'Samir', 'Lena', 'Kofi'];
const LAST = ['Chen', 'Walsh', 'Moreno', 'Patel', 'Okafor', 'Novak', 'Reyes', 'Lindqvist', 'Haddad', 'Tanaka', 'Silva', 'Brennan', 'Kowalski', 'Mensah', 'Dubois', 'Ibrahim', 'Rossi', 'Nakamura', 'Adeyemi', 'Kaur', 'Petrov', 'Garcia', 'Nguyen', 'Fischer', "O'Neill", 'Sato', 'Hassan', 'Costa', 'Berg', 'Asante'];
const TEAMS = ['Design', 'Engineering', 'Marketing', 'Client Success'];
const TITLES: Record<string, string[]> = {
  Design: ['Product Designer', 'Brand Designer', 'UX Researcher', 'Motion Designer'],
  Engineering: ['Frontend Engineer', 'Backend Engineer', 'QA Engineer', 'DevOps Engineer'],
  Marketing: ['Content Strategist', 'SEO Specialist', 'Copywriter', 'Growth Marketer'],
  'Client Success': ['Account Manager', 'Project Coordinator', 'Support Specialist', 'Onboarding Lead'],
};
const CLIENTS = ['Globex Retail', 'Initech Finance', 'Umbrella Health', 'Stark Logistics', 'Wayne Hospitality', 'Acme Outdoor', 'Hooli Media', 'Vandelay Imports', 'Soylent Foods', 'Wonka Confectionery'];
const PROJECT_KINDS = ['Website Redesign', 'Mobile App', 'Brand Refresh', 'SEO Retainer', 'Marketing Campaign', 'Support Retainer'];
const TASKS = ['Discovery workshop', 'Wireframes', 'Visual design', 'Design system', 'Frontend build', 'API integration', 'QA pass', 'Content migration', 'Launch checklist', 'Analytics setup', 'Copy review', 'Stakeholder review', 'Bug fixes', 'Performance tuning', 'Accessibility audit'];
const COLORS = ['#4B4FC4', '#1F5FD1', '#0E7490', '#16794A', '#9A5B00', '#C0362C', '#7C3AED', '#DB2777', '#0891B2', '#65A30D', '#EA580C', '#475569'];
const APPS: Record<string, string[]> = {
  Design: ['Figma', 'Photoshop', 'Illustrator', 'Chrome', 'Slack'],
  Engineering: ['VS Code', 'Terminal', 'Chrome', 'Slack', 'Docker Desktop'],
  Marketing: ['Chrome', 'Google Docs', 'Slack', 'Canva', 'Excel'],
  'Client Success': ['Chrome', 'Slack', 'Microsoft Teams', 'Excel', 'Outlook'],
};
const SITES: Record<string, string[]> = {
  Design: ['figma.com', 'dribbble.com', 'fonts.google.com', 'notion.so'],
  Engineering: ['github.com', 'stackoverflow.com', 'developer.mozilla.org', 'vercel.com'],
  Marketing: ['analytics.google.com', 'ahrefs.com', 'docs.google.com', 'linkedin.com'],
  'Client Success': ['mail.google.com', 'zendesk.com', 'calendar.google.com', 'notion.so'],
};
const ZONES = ['America/New_York', 'America/New_York', 'America/Chicago', 'Europe/London', 'Asia/Manila'];

/** Deterministic PRNG so the demo looks the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function screenshotSvg(r: () => number, title: string, app: string): string {
  const hue = Math.floor(r() * 360);
  const windows = Array.from({ length: 2 + Math.floor(r() * 3) }, (_, i) => {
    const x = 40 + Math.floor(r() * 500);
    const y = 50 + Math.floor(r() * 250);
    const w = 380 + Math.floor(r() * 420);
    const h = 220 + Math.floor(r() * 260);
    const lines = Array.from({ length: 6 }, (_, j) => `<rect x="${x + 20}" y="${y + 50 + j * 24}" width="${Math.floor(w * (0.3 + r() * 0.6))}" height="8" rx="4" fill="hsl(${hue} 15% ${80 - i * 6}%)"/>`).join('');
    return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="hsl(${(hue + i * 40) % 360} 20% ${97 - i * 3}%)" stroke="hsl(${hue} 20% 80%)"/><rect x="${x}" y="${y}" width="${w}" height="30" rx="10" fill="hsl(${hue} 25% 88%)"/><circle cx="${x + 16}" cy="${y + 15}" r="5" fill="#f87171"/><circle cx="${x + 32}" cy="${y + 15}" r="5" fill="#fbbf24"/><circle cx="${x + 48}" cy="${y + 15}" r="5" fill="#34d399"/>${lines}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800"><rect width="1280" height="800" fill="hsl(${hue} 30% 22%)"/>${windows}<rect x="0" y="770" width="1280" height="30" fill="rgba(0,0,0,.45)"/><text x="16" y="790" font-family="sans-serif" font-size="13" fill="#fff">${app} — ${title.replace(/[<&>]/g, '')}</text><text x="1150" y="790" font-family="sans-serif" font-size="12" fill="#fff" opacity=".7">DEMO DATA</text></svg>`;
}

export interface SeedOptions {
  days?: number;
  workers?: number;
  screenshotDays?: number;
  log?: (m: string) => void;
}

export async function seedDemo(baseDeps: Deps, opts: SeedOptions = {}): Promise<{ organizationId: string }> {
  const days = opts.days ?? 14;
  const workerCount = Math.min(opts.workers ?? 30, FIRST.length);
  const shotDays = opts.screenshotDays ?? 2;
  const log = opts.log ?? (() => undefined);
  const r = rng(20260925);
  const realNow = baseDeps.now();
  const clock = { now: new Date(realNow.getTime() - (days + 1) * 86400_000) };
  const deps: Deps = { ...baseDeps, now: () => clock.now, defer: () => undefined, config: { ...baseDeps.config, env: 'test' } };
  const app = createApp(deps);

  const call = async (method: string, path: string, body?: unknown, auth?: { cookie?: string; bearer?: string }, raw?: { data: Uint8Array | string; type: string }) => {
    const res = await app.request(`/api/v1${path}`, {
      method,
      headers: {
        Origin: deps.config.appUrl,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : raw ? { 'Content-Type': raw.type } : {}),
        ...(auth?.cookie ? { Cookie: auth.cookie } : {}),
        ...(auth?.bearer ? { Authorization: `Bearer ${auth.bearer}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : raw ? (raw.data as never) : undefined,
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown> & { [k: string]: any }) : ({} as any);
    if (res.status >= 400) throw new Error(`seed ${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    const cookie = res.headers.get('set-cookie')?.match(/tw_session=([^;]+)/)?.[1];
    return { json, cookie: cookie ? `tw_session=${cookie}` : undefined };
  };

  // ── Admin + org ──
  const su = await call('POST', '/auth/signup', { name: DEMO_ADMIN.name, email: DEMO_ADMIN.email, password: DEMO_ADMIN.password, organization_name: 'Northwind Creative (Demo)', timezone: 'America/New_York' });
  const orgId = su.json.organization_id as string;
  let admin = { cookie: su.cookie! };
  await withSystem(deps.db, (tx) => tx.update(organizations).set({ isDemo: true, timezone: 'America/New_York' }).where(eq(organizations.id, orgId)));
  const o = `/orgs/${orgId}`;
  log('org created');

  const roles = (await call('GET', `${o}/roles`, undefined, admin)).json as unknown as Array<{ id: string; key: string }>;
  const roleId = (k: string) => roles.find((x) => x.key === k)!.id;
  const adminMembership = ((await call('GET', `${o}`, undefined, admin)).json as any).membership.id as string;

  // ── Teams & workers ──
  const teamIds: Record<string, string> = {};
  for (const t of TEAMS) teamIds[t] = ((await call('POST', `${o}/teams`, { name: t }, admin)).json as any).id;

  interface W {
    id: string;
    name: string;
    team: string;
    tz: string;
    auth: { cookie: string };
    email: string;
    manager: boolean;
    diligence: number;
  }
  const workers: W[] = [];
  for (let i = 0; i < workerCount; i++) {
    const team = TEAMS[i % TEAMS.length]!;
    const manager = i < TEAMS.length; // first of each team leads it
    const name = `${FIRST[i]} ${LAST[i]}`;
    const email = `${FIRST[i]!.toLowerCase()}.${LAST[i]!.toLowerCase().replace(/[^a-z]/g, '')}@demo.tallywork.app`;
    const inv = await call('POST', `${o}/invitations`, { email, name, role_id: roleId(manager ? 'TEAM_MANAGER' : 'WORKER'), team_ids: [teamIds[team]] }, admin);
    const token = new URL(inv.json.invite_url as string).searchParams.get('token')!;
    const acc = await call('POST', '/auth/invitations/accept', { token, name, password: DEMO_ADMIN.password });
    const tz = ZONES[i % ZONES.length]!;
    const id = acc.json.membership_id as string;
    await call('PATCH', `${o}/workers/${id}`, { title: TITLES[team]![i % 4], timezone: tz, weekly_expected_seconds: 40 * 3600 }, admin);
    if (manager) await call('PUT', `${o}/teams/${teamIds[team]}/members/${id}`, { role: 'MANAGER' }, admin);
    workers.push({ id, name, team, tz, auth: { cookie: acc.cookie! }, email, manager, diligence: 0.55 + r() * 0.4 });
  }
  log(`${workers.length} workers`);

  // ── Clients, projects, tasks, rates, budgets ──
  const clientIds: string[] = [];
  for (const c of CLIENTS) clientIds.push(((await call('POST', `${o}/clients`, { name: c, email: `billing@${c.split(' ')[0]!.toLowerCase()}.example`, currency: 'USD', address: `${100 + Math.floor(r() * 800)} Market Street\nSuite ${10 + Math.floor(r() * 90)}` }, admin)).json as any).id);
  interface P {
    id: string;
    team: string;
    tasks: string[];
    client: string;
  }
  const projects: P[] = [];
  for (let i = 0; i < 20; i++) {
    const client = clientIds[i % clientIds.length]!;
    const team = TEAMS[i % TEAMS.length]!;
    const secondTeam = TEAMS[(i + 1) % TEAMS.length]!;
    const name = `${CLIENTS[i % CLIENTS.length]!.split(' ')[0]} — ${PROJECT_KINDS[i % PROJECT_KINDS.length]}`;
    const p = await call('POST', `${o}/projects`, { name, client_id: client, color: COLORS[i % COLORS.length], team_ids: i % 3 === 0 ? [teamIds[team], teamIds[secondTeam]] : [teamIds[team]], billable_default: i % 7 !== 6, member_ids: [adminMembership] }, admin);
    const pid = (p.json as any).id as string;
    const tasks: string[] = [];
    for (let k = 0; k < 5; k++) {
      const teamWorkers = workers.filter((w) => w.team === team);
      const assignee = teamWorkers[(i + k) % teamWorkers.length]!;
      const t = await call('POST', `${o}/projects/${pid}/tasks`, { title: TASKS[(i * 5 + k) % TASKS.length], priority: (['LOW', 'MEDIUM', 'HIGH', 'MEDIUM', 'URGENT'] as const)[k], status: k === 0 ? 'DONE' : k < 3 ? 'IN_PROGRESS' : 'TODO', estimate_seconds: (4 + Math.floor(r() * 20)) * 3600, due_date: addDaysToDate(localDate(realNow, 'UTC'), Math.floor(r() * 30) - 5), assignee_ids: [assignee.id] }, admin);
      tasks.push((t.json as any).id);
    }
    projects.push({ id: pid, team, tasks, client });
    await call('POST', `${o}/rates`, { kind: 'BILL', scope: 'PROJECT', scope_id: pid, amount_minor: (90 + Math.floor(r() * 8) * 10) * 100, currency: 'USD', effective_from: '2024-01-01' }, admin);
    if (i < 12) await call('PUT', `${o}/budgets`, { subject_type: 'PROJECT', subject_id: pid, kind: i % 2 ? 'MONEY' : 'HOURS', amount: i % 2 ? (15_000 + Math.floor(r() * 30_000)) * 100 : (60 + Math.floor(r() * 120)) * 3600, warn_pct: 80 }, admin);
  }
  for (let i = 0; i < 4; i++) await call('PUT', `${o}/budgets`, { subject_type: 'CLIENT', subject_id: clientIds[i], kind: 'MONEY', amount: (60_000 + i * 20_000) * 100, period: 'MONTHLY', warn_pct: 75 }, admin);
  await call('POST', `${o}/rates`, { kind: 'BILL', scope: 'ORG', amount_minor: 9500, currency: 'USD', effective_from: '2024-01-01' }, admin);
  for (const w of workers) await call('POST', `${o}/rates`, { kind: 'PAY', scope: 'WORKER', scope_id: w.id, amount_minor: (28 + Math.floor(r() * 30)) * 100, currency: 'USD', effective_from: '2024-01-01' }, admin);
  await call('PUT', `${o}/policies/ORG/${orgId}`, { screenshots: { enabled: true, perTenMinutes: 1, blur: false }, urls: { enabled: true, mode: 'domain', excludedDomains: ['bank.example'] }, idle: { thresholdMinutes: 5, behavior: 'prompt' } }, admin);
  await call('PUT', `${o}/policies/TEAM/${teamIds['Client Success']}`, { screenshots: { blur: true } }, admin);
  log('work structure');

  // ── Schedules, holidays, time off ──
  const start = addDaysToDate(localDate(realNow, 'UTC'), -days - 7);
  for (const w of workers) {
    await call('POST', `${o}/schedules`, { membership_id: w.id, timezone: w.tz, days: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: '09:00', end: '17:00' })), effective_from: start }, admin);
  }
  const pto = ((await call('POST', `${o}/time-off/policies`, { name: 'Paid time off', accrual: { type: 'monthly', amountHours: 10, maxBalanceHours: 200, carryOverHours: 40 }, hours_per_day: 8 }, admin)).json as any).id;
  await call('POST', `${o}/time-off/policies`, { name: 'Sick leave', accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, requires_approval: false, hours_per_day: 8 }, admin);
  for (const w of workers) await call('POST', `${o}/time-off/balances/adjust`, { policy_id: pto, membership_id: w.id, hours: 40 + Math.floor(r() * 60), note: 'Opening balance (demo)' }, admin);
  await call('POST', `${o}/holidays`, { date: `${realNow.getUTCFullYear()}-12-25`, name: 'Christmas Day' }, admin);
  await call('POST', `${o}/holidays`, { date: `${realNow.getUTCFullYear() + 1}-01-01`, name: "New Year's Day" }, admin);

  // ── Devices ──
  const agents = new Map<string, string>();
  const refreshTokens = new Map<string, { token: string; at: number }>();
  for (const w of workers) {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const code = (await call('POST', '/agent/authorize', { code_challenge: challenge, organization_id: orgId }, w.auth)).json.code as string;
    const platform = (['macos', 'windows', 'windows', 'linux'] as const)[Math.floor(r() * 4)]!;
    const reg = await call('POST', '/agent/register', { code, code_verifier: verifier, device: { name: `${w.name.split(' ')[0]}'s ${platform === 'macos' ? 'MacBook Pro' : platform === 'windows' ? 'ThinkPad' : 'Workstation'}`, platform, os_version: platform === 'macos' ? '15.4' : platform === 'windows' ? '11 24H2' : 'Ubuntu 24.04', agent_version: '0.1.0', capabilities: { input: true, screenshots: true, apps: true, urls: true } } });
    agents.set(w.id, reg.json.access_token as string);
    refreshTokens.set(w.id, { token: reg.json.refresh_token as string, at: Date.now() });
  }
  log('devices');

  // ── Tracking history via agent ingest ──
  /** Access tokens live 10 real minutes; rotate with the refresh token when older than 8. */
  const tokenFor = async (w: W) => {
    const rt = refreshTokens.get(w.id)!;
    if (Date.now() - rt.at > 8 * 60_000) {
      const res = await call('POST', '/agent/token', { refresh_token: rt.token });
      agents.set(w.id, res.json.access_token as string);
      refreshTokens.set(w.id, { token: res.json.refresh_token as string, at: Date.now() });
    }
    return agents.get(w.id)!;
  };

  const today = localDate(realNow, 'America/New_York');
  for (let d = days; d >= 0; d--) {
    for (const w of workers) {
      const date = addDaysToDate(localDate(realNow, w.tz), -d);
      const dow = dayOfWeek(date);
      if (dow === 0 || dow === 6) continue;
      if (r() < 0.04) continue; // occasional absence
      const myProjects = projects.filter((p) => p.team === w.team || projects.indexOf(p) % 3 === 0 && TEAMS[(projects.indexOf(p) + 1) % 4] === w.team);
      const blocks = [
        { h: 8 + Math.floor(r() * 2), m: Math.floor(r() * 60), len: 150 + Math.floor(r() * 90) },
        { h: 13, m: Math.floor(r() * 45), len: 150 + Math.floor(r() * 110) },
      ];
      for (const b of blocks) {
        const startAt = zonedWallTimeToUtc(date, w.tz, b.h, b.m);
        if (startAt.getTime() + 60_000 > realNow.getTime()) continue;
        const project = myProjects[Math.floor(r() * myProjects.length)] ?? projects[0]!;
        const task = project.tasks[Math.floor(r() * project.tasks.length)]!;
        const isToday = d === 0;
        const liveSession = isToday && b.h === 13 && r() < 0.5; // some people are working right now
        const endAt = new Date(Math.min(startAt.getTime() + b.len * 60_000, realNow.getTime() - 60_000));
        const lenMin = Math.floor((endAt.getTime() - startAt.getTime()) / 60_000);
        if (lenMin < 5) continue;
        const sessionId = newId();
        const events: unknown[] = [{ event_id: newId(), type: 'session.start', session_id: sessionId, seq: 1, occurred_at: startAt.toISOString(), project_id: project.id, task_id: task }];
        const minutes = Array.from({ length: lenMin }, (_, i) => {
          const base = w.diligence * 60;
          const active = Math.max(0, Math.min(60, Math.round(base + (r() - 0.5) * 40)));
          return { minute_start: new Date(startAt.getTime() + i * 60_000).toISOString(), keyboard: Math.round(active * (1 + r() * 2)), mouse: Math.round(active * (0.5 + r())), active_seconds: active, tracked_seconds: 60 };
        });
        events.push({ event_id: newId(), type: 'activity.minutes', session_id: sessionId, occurred_at: endAt.toISOString(), minutes });
        const apps = APPS[w.team]!;
        const sites = SITES[w.team]!;
        const appSpans: unknown[] = [];
        const urlSpans: unknown[] = [];
        for (let t = 0; t < lenMin; ) {
          const dur = 5 + Math.floor(r() * 25);
          const s = new Date(startAt.getTime() + t * 60_000);
          const e = new Date(Math.min(endAt.getTime(), s.getTime() + dur * 60_000));
          const app = apps[Math.floor(r() * apps.length)]!;
          appSpans.push({ span_id: newId(), app_name: app, app_id: app.toLowerCase().replace(/\s/g, '') + '.exe', started_at: s.toISOString(), ended_at: e.toISOString() });
          if (app === 'Chrome') urlSpans.push({ span_id: newId(), domain: sites[Math.floor(r() * sites.length)], browser: 'Chrome', started_at: s.toISOString(), ended_at: e.toISOString() });
          t += dur;
        }
        events.push({ event_id: newId(), type: 'app.spans', session_id: sessionId, occurred_at: endAt.toISOString(), spans: appSpans });
        if (urlSpans.length) events.push({ event_id: newId(), type: 'url.spans', session_id: sessionId, occurred_at: endAt.toISOString(), spans: urlSpans });
        if (lenMin > 60 && r() < 0.25) {
          const idleStart = new Date(startAt.getTime() + Math.floor(lenMin / 2) * 60_000);
          const idleEnd = new Date(idleStart.getTime() + (6 + Math.floor(r() * 10)) * 60_000);
          const idleId = newId();
          events.push({ event_id: newId(), type: 'idle.started', session_id: sessionId, occurred_at: idleStart.toISOString(), idle_id: idleId, started_at: idleStart.toISOString() });
          events.push({ event_id: newId(), type: 'idle.resolved', session_id: sessionId, occurred_at: idleEnd.toISOString(), idle_id: idleId, started_at: idleStart.toISOString(), ended_at: idleEnd.toISOString(), resolution: r() < 0.7 ? 'DISCARDED' : 'KEPT' });
        }
        clock.now = endAt;
        await call('POST', '/agent/ingest/batch', { sent_at: endAt.toISOString(), events }, { bearer: await tokenFor(w) });

        // Screenshots for the most recent days.
        if (d < shotDays) {
          const shots: unknown[] = [];
          for (let t = 3; t < lenMin; t += 10 + Math.floor(r() * 6)) {
            const at = new Date(startAt.getTime() + t * 60_000);
            const id = newId();
            const svg = screenshotSvg(r, `${project.id.slice(0, 4)} ${TASKS[Math.floor(r() * TASKS.length)]}`, apps[Math.floor(r() * apps.length)]!);
            const intent = await call('POST', '/agent/screenshots/upload-intent', { screenshot_id: id, session_id: sessionId, captured_at: at.toISOString(), content_type: 'image/png', bytes: svg.length }, { bearer: await tokenFor(w) });
            const key = intent.json.storage_key as string;
            await deps.storage.put(key, Buffer.from(svg), 'image/svg+xml');
            shots.push({ event_id: newId(), type: 'screenshot.captured', session_id: sessionId, occurred_at: at.toISOString(), screenshot_id: id, captured_at: at.toISOString(), display_index: 0, blurred: w.team === 'Client Success', width: 1280, height: 800, bytes: svg.length, sha256: createHash('sha256').update(svg).digest('hex'), storage_key: key });
          }
          if (shots.length) await call('POST', '/agent/ingest/batch', { sent_at: endAt.toISOString(), events: shots }, { bearer: await tokenFor(w) });
        }

        if (!liveSession) {
          await call('POST', '/agent/ingest/batch', { sent_at: endAt.toISOString(), events: [{ event_id: newId(), type: 'session.stop', session_id: sessionId, seq: 2, occurred_at: endAt.toISOString() }] }, { bearer: await tokenFor(w) });
        } else {
          clock.now = realNow;
          await call('POST', '/agent/heartbeat', { sent_at: realNow.toISOString(), session_id: sessionId, agent_version: '0.1.0' }, { bearer: await tokenFor(w) });
        }
      }
    }
    if (d % 3 === 0) log(`tracking: ${days - d + 1}/${days + 1} days`);
  }

  clock.now = new Date(realNow.getTime() - 60_000);
  // Sessions created at the start of the simulated period have expired by now: sign in again.
  const login = async (email: string) => ({ cookie: (await call('POST', '/auth/login', { email, password: DEMO_ADMIN.password })).cookie! });
  admin = await login(DEMO_ADMIN.email);
  for (const w of workers) w.auth = await login(w.email);
  // ── Manual time, timesheets, approvals ──
  for (const [i, w] of workers.entries()) {
    if (i % 5 === 0) {
      const date = addDaysToDate(localDate(realNow, w.tz), -3);
      const s = zonedWallTimeToUtc(date, w.tz, 18, 0);
      const p = projects.find((pp) => pp.team === w.team)!;
      await call('POST', `${o}/manual-time`, { project_id: p.id, started_at: s.toISOString(), ended_at: new Date(s.getTime() + 90 * 60_000).toISOString(), reason: 'Client call from phone — desktop app was closed', note: 'Kick-off call' }, w.auth).catch(() => undefined);
    }
  }
  const lastWeek = addDaysToDate(today, -7);
  const twoWeeks = addDaysToDate(today, -14);
  for (const [i, w] of workers.entries()) {
    for (const date of [twoWeeks, lastWeek]) {
      if (date === lastWeek && i % 4 === 3) continue; // some haven't submitted yet
      await call('POST', `${o}/timesheets/submit`, { date }, w.auth).catch(() => undefined);
    }
  }
  const queue = (await call('GET', `${o}/timesheets/approvals`, undefined, admin)).json as unknown as Array<{ timesheet_id: string; period_start: string }>;
  for (const [i, q] of queue.entries()) {
    if (q.period_start <= twoWeeks || i % 3 === 0) await call('POST', `${o}/timesheets/${q.timesheet_id}/approve`, {}, admin).catch(() => undefined);
    else if (i % 7 === 1) await call('POST', `${o}/timesheets/${q.timesheet_id}/reject`, { comment: 'Please add notes for Wednesday afternoon.' }, admin).catch(() => undefined);
  }
  log('timesheets');

  // ── Time off requests, expenses ──
  for (const [i, w] of workers.slice(0, 10).entries()) {
    const s = addDaysToDate(today, 5 + i * 2);
    try {
      const req = await call('POST', `${o}/time-off/requests`, { policy_id: pto, start_date: s, end_date: addDaysToDate(s, i % 3), reason: ['Family trip', 'Personal day', 'Moving house', 'Medical appointment'][i % 4] }, w.auth);
      if (i % 2 === 0) await call('POST', `${o}/time-off/requests/${req.json.id}/approve`, {}, admin);
    } catch {
      /* weekend-only ranges are skipped */
    }
  }
  const categories = ['Software', 'Travel', 'Meals', 'Equipment', 'Stock photos'];
  for (const [i, w] of workers.slice(0, 12).entries()) {
    const p = projects.find((pp) => pp.team === w.team)!;
    const e = await call('POST', `${o}/expenses`, { project_id: p.id, category: categories[i % categories.length], description: ['Figma seat', 'Train to client site', 'Team lunch with client', 'USB-C dock', 'Hero image license'][i % 5], amount_minor: (20 + Math.floor(r() * 400)) * 100, currency: 'USD', spent_on: addDaysToDate(today, -Math.floor(r() * 10)), billable: i % 2 === 0 }, w.auth);
    if (i % 3 !== 2) await call('POST', `${o}/expenses/${e.json.id}/approve`, {}, admin);
  }

  // ── Invoices & payments ──
  for (const [i, c] of clientIds.slice(0, 4).entries()) {
    try {
      const inv = await call('POST', `${o}/invoices`, { client_id: c, period_start: addDaysToDate(today, -40), period_end: addDaysToDate(today, -8), issue_date: addDaysToDate(today, -6), due_date: addDaysToDate(today, i === 3 ? -1 : 24), tax_rate_bps: 0, notes: 'Thank you for your business. (Demo invoice)' }, admin);
      if (i < 3) await call('POST', `${o}/invoices/${inv.json.id}/send`, {}, admin);
      if (i === 3) await call('POST', `${o}/invoices/${inv.json.id}/send`, {}, admin);
      if (i === 0) await call('POST', `${o}/payments`, { client_id: c, amount_minor: inv.json.total_minor, currency: 'USD', received_on: addDaysToDate(today, -2), provider: 'bank_transfer', provider_ref: 'DEMO-ACH-10492', allocations: [{ invoice_id: inv.json.id, amount_minor: inv.json.total_minor }] }, admin);
      if (i === 1) await call('POST', `${o}/payments`, { client_id: c, amount_minor: Math.floor(inv.json.total_minor / 2), currency: 'USD', received_on: addDaysToDate(today, -1), provider: 'card', allocations: [{ invoice_id: inv.json.id, amount_minor: Math.floor(inv.json.total_minor / 2) }] }, admin);
    } catch (e) {
      log(`invoice skipped: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  log('finance');

  clock.now = realNow;
  let n = 0;
  do n = await dispatchOutbox(deps, 1000);
  while (n > 0);
  log('rollups built');
  return { organizationId: orgId };
}
