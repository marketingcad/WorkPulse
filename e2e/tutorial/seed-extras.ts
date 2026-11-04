/**
 * Adds what the video shows but the demo seed (packages/api/src/seed.ts) does not create:
 * end-of-day reports written at clock-out by a few members over the last two evenings.
 * Run by serve-tutorial.mjs right after the seed, against the same throwaway database.
 *
 * Like the seed, it goes through the public API in-process with a controllable clock, so the
 * reports arrive the way the desktop app sends them (a session.stop with its report).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const web = path.resolve(import.meta.dirname, '../../apps/web');
// @tallywork/api and @tallywork/db are dependencies of the web app, not of the e2e package.
const fromWeb = createRequire(path.join(web, 'package.json'));
const load = (id: string) => import(pathToFileURL(fromWeb.resolve(id)).href);
const api = await load('@tallywork/api');
const { createDb } = await load('@tallywork/db/client');
const domain = await load('@tallywork/domain');

const PASSWORD = 'demo-password-123';
const REPORTS: Array<{ email: string; text: string; finished: boolean }> = [
  { email: 'maya.chen@demo.tallywork.app', text: 'Reviewed the Globex homepage wireframes with the client and agreed on the new navigation. Updated the design system tokens for buttons and form fields. Tomorrow: hand off the checkout screens to engineering.', finished: false },
  { email: 'liam.walsh@demo.tallywork.app', text: 'Finished the API integration for the Initech dashboard and fixed two failing tests. Deployed to staging for QA.', finished: true },
  { email: 'sofia.moreno@demo.tallywork.app', text: 'Drafted the October campaign brief for Umbrella Health and sent it for review. Keyword research for the SEO retainer is 70% done.', finished: false },
  { email: 'noah.patel@demo.tallywork.app', text: 'Onboarding call with Stark Logistics: walked them through the client portal. Updated the project plan with the new launch date.', finished: true },
  { email: 'isla.reyes@demo.tallywork.app', text: 'Visual design for the Wonka landing page is ready for feedback. Exported the hero illustrations in three sizes.', finished: true },
  { email: 'lucas.lindqvist@demo.tallywork.app', text: 'Performance tuning on the Hooli media site: image loading is 40% faster. Still investigating the slow search page.', finished: false },
];

const dataDir = process.env.DATABASE_URL!;
const h = createDb(dataDir);
const clock = { now: new Date() };
const realNow = new Date();
const config = { ...api.loadConfig({ ...process.env, NODE_ENV: 'development' }), env: 'test' };
const deps = { db: h.db, config, storage: api.createStorage(), mailer: api.createMailer({ NODE_ENV: 'test' }), defer: () => undefined, now: () => clock.now };
const app = api.createApp(deps);

async function call(method: string, p: string, body?: unknown, bearer?: string) {
  const res = await app.request(`/api/v1${p}`, { method, headers: { Origin: config.appUrl, 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`seed-extras ${method} ${p} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

let made = 0;
for (const [i, r] of REPORTS.entries()) {
  clock.now = new Date(realNow.getTime() - 60_000);
  const login = await call('POST', '/agent/login', { email: r.email, password: PASSWORD, device: { name: 'Work laptop', platform: 'windows', agent_version: '0.1.9' } });
  const boot = await call('GET', '/agent/bootstrap', undefined, login.access_token);
  const tz: string = boot.worker.timezone;
  const project = boot.assignments[i % boot.assignments.length];
  if (!project) continue;
  // An evening session after the seed's working blocks, one or two days ago, closed with a report.
  const daysAgo = 1 + (i % 2);
  const date = domain.addDaysToDate(domain.localDate(realNow, tz), -daysAgo);
  const start = domain.zonedWallTimeToUtc(date, tz, 18, 10 + i * 3);
  const end = new Date(start.getTime() + 35 * 60_000);
  if (end.getTime() > realNow.getTime()) continue;
  const sessionId = domain.newId();
  clock.now = end;
  await call('POST', '/agent/ingest/batch', {
    sent_at: end.toISOString(),
    events: [
      { event_id: domain.newId(), type: 'session.start', session_id: sessionId, seq: 1, occurred_at: start.toISOString(), project_id: project.project_id },
      { event_id: domain.newId(), type: 'session.stop', session_id: sessionId, seq: 2, occurred_at: end.toISOString(), report: { text: r.text, finished: r.finished } },
    ],
  }, login.access_token);
  made++;
}
clock.now = realNow;
let n = 0;
do n = await api.dispatchOutbox(deps, 1000);
while (n > 0);
console.log(`[tutorial] ${made} end-of-day reports added`);
await h.close();
