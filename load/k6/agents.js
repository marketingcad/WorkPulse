// Desktop agents at scale: every agent syncs one batch every 30 s and heartbeats every 60 s.
// Target (roadmap Phase 14): 10,000 concurrent agents, ingest p95 < 500 ms.
//
//   k6 run -e AGENTS=10000 -e DURATION=30m load/k6/agents.js
//
// Needs load/tokens.json from `load/provision.ts`. Thresholds fail the run when an SLO is missed.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

const data = JSON.parse(open('../tokens.json'));
const agents = new SharedArray('agents', () => data.agents);
const BASE = data.base_url;
const AGENTS = Number(__ENV.AGENTS || agents.length);

export const options = {
  scenarios: {
    agents: { executor: 'constant-vus', vus: Math.min(AGENTS, agents.length), duration: __ENV.DURATION || '10m', gracefulStop: '30s' },
  },
  thresholds: {
    'http_req_duration{name:ingest}': ['p(95)<500'],
    'http_req_duration{name:heartbeat}': ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

function uuidv7() {
  const ms = Date.now().toString(16).padStart(12, '0');
  const r = () => Math.floor(Math.random() * 16).toString(16);
  const rand = Array.from({ length: 20 }, r).join('');
  return `${ms.slice(0, 8)}-${ms.slice(8, 12)}-7${rand.slice(0, 3)}-${'89ab'[Math.floor(Math.random() * 4)]}${rand.slice(3, 6)}-${rand.slice(6, 18)}`;
}

const state = {};

function auth(vu) {
  const s = state[vu];
  return { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access}` } };
}

function refresh(vu) {
  const s = state[vu];
  const r = http.post(`${BASE}/agent/token`, JSON.stringify({ refresh_token: s.refresh }), { headers: { 'Content-Type': 'application/json' }, tags: { name: 'refresh' } });
  if (r.status === 200) {
    s.access = r.json('access_token');
    s.refresh = r.json('refresh_token');
  }
}

function post(vu, path, body, name) {
  let r = http.post(`${BASE}${path}`, JSON.stringify(body), { ...auth(vu), tags: { name } });
  if (r.status === 401) {
    refresh(vu); // access tokens last 10 minutes
    r = http.post(`${BASE}${path}`, JSON.stringify(body), { ...auth(vu), tags: { name } });
  }
  return r;
}

export default function () {
  const vu = exec.vu.idInTest;
  if (!state[vu]) {
    const a = agents[(vu - 1) % agents.length];
    state[vu] = { access: a.access_token, refresh: a.refresh_token, project: a.project_id, session: uuidv7(), seq: 1, started: false, beats: 0 };
  }
  const s = state[vu];
  const now = new Date();
  const events = [];
  if (!s.started) {
    events.push({ event_id: uuidv7(), type: 'session.start', session_id: s.session, seq: 1, occurred_at: now.toISOString(), project_id: s.project });
    s.started = true;
  }
  const minute = new Date(Math.floor(now.getTime() / 60000) * 60000 - 60000).toISOString();
  events.push({ event_id: uuidv7(), type: 'activity.minutes', session_id: s.session, occurred_at: now.toISOString(), minutes: [{ minute_start: minute, keyboard: 30, mouse: 80, active_seconds: 40, tracked_seconds: 60 }] });
  events.push({ event_id: uuidv7(), type: 'app.spans', session_id: s.session, occurred_at: now.toISOString(), spans: [{ span_id: uuidv7(), app_name: 'Code', app_id: null, started_at: new Date(now.getTime() - 30000).toISOString(), ended_at: now.toISOString() }] });
  const r = post(vu, '/agent/ingest/batch', { sent_at: now.toISOString(), events }, 'ingest');
  check(r, { 'ingest 200': (x) => x.status === 200, 'events accepted': (x) => x.status === 200 && x.json('results').every((e) => e.status !== 'rejected') });
  if (++s.beats % 2 === 0) {
    const h = post(vu, '/agent/heartbeat', { sent_at: now.toISOString(), session_id: s.session, agent_version: '0.1.0' }, 'heartbeat');
    check(h, { 'heartbeat 200': (x) => x.status === 200 });
  }
  sleep(30);
}
