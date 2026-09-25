// Managers reading dashboards, time and reports while agents sync. Target: read p95 < 300 ms.
//
//   k6 run -e VUS=50 -e DURATION=10m load/k6/reads.js
//
// Uses the load-test admin from load/tokens.json (created by load/provision.ts).
import http from 'k6/http';
import { check, sleep } from 'k6';

const data = JSON.parse(open('../tokens.json'));
const BASE = data.base_url;
const ORG = `${BASE}/orgs/${data.org_id}`;

export const options = {
  vus: Number(__ENV.VUS || 20),
  duration: __ENV.DURATION || '5m',
  thresholds: {
    'http_req_duration{kind:read}': ['p(95)<300'],
    'http_req_duration{name:report}': ['p(95)<1500'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  const r = http.post(`${BASE}/auth/login`, JSON.stringify({ email: data.admin_email, password: data.admin_password }), { headers: { 'Content-Type': 'application/json', Origin: new URL(BASE).origin } });
  check(r, { 'login 200': (x) => x.status === 200 });
  return { cookie: `tw_session=${r.cookies.tw_session[0].value}` };
}

const day = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

export default function ({ cookie }) {
  const h = { headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: new URL(BASE).origin } };
  const get = (path, name) => check(http.get(`${ORG}${path}`, { ...h, tags: { name, kind: 'read' } }), { [`${name} 200`]: (x) => x.status === 200 });
  get('/dashboard/widgets?keys=worked_today,tracked_week,active_workers,timesheets_to_approve,hours_by_project,attendance_today&scope=ALL', 'dashboard');
  get('/tracking/live', 'live');
  get(`/time-entries?from=${day(7)}&to=${day(0)}`, 'time-entries');
  get(`/attendance?from=${day(0)}&to=${day(0)}`, 'attendance');
  const rep = http.post(`${ORG}/reports/time-activity/query`, JSON.stringify({ from: day(30), to: day(0) }), { ...h, tags: { name: 'report' } });
  check(rep, { 'report 200': (x) => x.status === 200 });
  sleep(5);
}
