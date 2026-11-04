import { request, type Page } from '@playwright/test';
import { expect, ok, test, uid } from '../../support/fixtures';
import { ADMIN_STATE, WEB_URL, WORKER_STATE } from '../../support/env';

/**
 * Every page built on the shared DataTable, at phone and tablet widths, with the run's data (UX audit C2).
 * Each page must not scroll sideways, every row's actions on the stacked cards must match the
 * desktop table's (the cards used to drop them), and whichever layout is on screen at that width
 * must offer all of them (768px is the edge where the table replaces the cards). Static coverage of the same rule for every column
 * is in apps/web/test/table-actions.test.ts; this checks what people actually get on a phone.
 *
 * Not swept: /support (the platform support console needs a support-staff account the suite does
 * not create; its tables have no row actions).
 */
test.use({ storageState: ADMIN_STATE });

const VIEWPORTS = [
  { name: 'a phone', width: 390, height: 844 },
  { name: 'a tablet (portrait)', width: 768, height: 1024 },
  { name: 'a tablet (landscape)', width: 1024, height: 768 },
] as const;

interface Target {
  name: string;
  path: string | ((ids: Ids) => string);
  /** a tab to open first, for tables inside tabbed pages */
  tab?: string;
}
interface Ids {
  payrollRun: string;
  report: string;
  project: string;
  member: string;
}

const PAGES: Target[] = [
  { name: 'Attendance', path: '/attendance' },
  { name: 'Clients', path: '/clients' },
  { name: 'API keys', path: '/developer/api-keys' },
  { name: 'Webhooks', path: '/developer/webhooks' },
  { name: 'Devices', path: '/devices' },
  { name: 'Rates', path: '/finance/billing' },
  { name: 'Budgets', path: '/finance/budgets' },
  { name: 'Expenses', path: '/finance/expenses' },
  { name: 'Invoices', path: '/finance/invoices' },
  { name: 'Payments received', path: '/finance/invoices/payments' },
  { name: 'Payrolls', path: '/finance/payroll' },
  { name: 'Payroll: Owed', path: '/finance/payroll', tab: 'Owed' },
  { name: 'Payroll: Pay groups', path: '/finance/payroll', tab: 'Pay groups' },
  { name: 'Payroll run', path: (i) => `/finance/payroll/${i.payrollRun}` },
  { name: 'Summary', path: '/insights' },
  { name: 'My pay stubs', path: '/pay-stubs' },
  { name: 'Project', path: (i) => `/projects/${i.project}` },
  { name: 'Project documents', path: (i) => `/projects/${i.project}`, tab: 'Documents' },
  { name: 'Projects', path: '/projects' },
  { name: 'Report', path: (i) => `/reports/${i.report}` },
  { name: 'Session history', path: '/sessions' },
  { name: 'Access review', path: '/settings/access-review' },
  { name: 'Audit log', path: '/settings/audit' },
  { name: 'Time & pay (time types, break types)', path: '/settings/time' },
  { name: 'Tasks', path: '/tasks' },
  { name: 'Teams', path: '/teams' },
  { name: 'Team week', path: '/timesheets/team' },
  { name: 'Approvals (timesheets, manual time)', path: '/timesheets/approvals' },
  { name: 'Manual time', path: '/timesheets/manual' },
  { name: 'Live', path: '/tracking/live' },
  { name: 'Member profile', path: (i) => `/workers/${i.member}` },
  { name: 'Members', path: '/workers' },
  { name: 'Time off: policies', path: '/time-off?tab=admin' },
  { name: 'Time off: mine', path: '/time-off?tab=mine' },
  { name: 'Time off: requests', path: '/time-off?tab=requests' },
  { name: 'Activity: apps', path: '/activity', tab: 'Apps' },
];

let ids: Ids;

/**
 * One record with row actions for each table, so the comparison has something to compare: the
 * run's base data leaves most lists empty. The worker's own requests make Approve/Reject appear.
 */
async function seed(data: import('../../support/global-setup').E2EData, { api, orgApi }: { api: import('@playwright/test').APIRequestContext; orgApi: (p: string) => string }, workerIndex: number) {
  const tag = `Phone ${uid()}`;
  const day = new Date().toISOString().slice(0, 10);
  // beforeAll runs in each worker process: one day of leave each, as overlapping requests are refused.
  const leaveDay = new Date(Date.UTC(2027, 5, 1) + workerIndex * 86400_000).toISOString().slice(0, 10);
  const worker = await request.newContext({ baseURL: WEB_URL, storageState: WORKER_STATE, extraHTTPHeaders: { Origin: WEB_URL } });
  const w = (p: string) => `/api/v1/orgs/${data.orgId}${p}`;
  const roles = await ok<Array<{ id: string; key: string }>>(await api.get(orgApi('/roles')), 'roles');
  // A project of its own: tasks or time added to the shared fixture projects would change what other specs see.
  const project = await ok<{ id: string }>(await api.post(orgApi('/projects'), { data: { name: `${tag} project`, member_ids: [data.worker.membershipId] } }), 'project');
  await ok(await api.post(orgApi('/clients'), { data: { name: `${tag} client` } }), 'client');
  await ok(await api.post(orgApi('/api-keys'), { data: { name: `${tag} key`, scopes: ['read:clients'] } }), 'api key');
  // Disabled: the row and its actions show, and the isolated test server never calls out to the internet.
  await ok(await api.post(orgApi('/webhooks'), { data: { url: 'https://93.184.216.34/e2e-phone', events: ['timesheet.approved'], enabled: false } }), 'webhook');
  await ok(await api.put(orgApi('/budgets'), { data: { subject_type: 'PROJECT', subject_id: project.id, kind: 'HOURS', amount: 36_000 } }), 'budget');
  await ok(await api.post(orgApi('/payments'), { data: { amount_minor: 1000, currency: 'USD', received_on: day } }), 'payment');
  await ok(await api.post(orgApi(`/projects/${project.id}/tasks`), { data: { title: `${tag} task` } }), 'task');
  await ok(await api.post(orgApi('/time-types'), { data: { name: `${tag} type`, short_name: 'PH', pay_coefficient: 1, bill_coefficient: 1 } }), 'time type');
  await ok(await api.post(orgApi('/break-types'), { data: { name: `${tag} break` } }), 'break type');
  await ok(await api.post(orgApi('/invitations'), { data: { email: `phone+${uid()}@e2e.test`, name: `${tag} invitee`, role_id: roles.find((r) => r.key === 'WORKER')!.id } }), 'invitation');
  const policy = await ok<{ id: string }>(
    await api.post(orgApi('/time-off/policies'), { data: { name: `${tag} leave`, accrual: { type: 'none', amountHours: 0, maxBalanceHours: null, carryOverHours: null }, applies_to_all: false, member_ids: [data.worker.membershipId] } }),
    'policy',
  );
  await ok(await worker.post(w('/time-off/requests'), { data: { policy_id: policy.id, start_date: leaveDay, end_date: leaveDay, half_day: false, reason: tag } }), 'time off request');
  await ok(await worker.post(w('/expenses'), { data: { category: 'Travel', amount_minor: 1234, currency: 'USD', spent_on: day } }), 'expense');
  await worker.post(w('/manual-time'), { data: { project_id: project.id, started_at: '2025-08-04T09:00:00.000Z', ended_at: '2025-08-04T10:00:00.000Z', reason: tag } });
  await worker.dispose();
  return project.id;
}

test.beforeAll(async ({ data, adminApi, browser, workerDevice }, workerInfo) => {
  void workerDevice; // a signed-in desktop device, so Devices has a row with actions
  const project = await seed(data, adminApi, workerInfo.workerIndex);
  const runs = await ok<Array<{ id: string }> | { data: Array<{ id: string }> }>(await adminApi.api.get(adminApi.orgApi('/payroll/runs')), 'payroll runs');
  const payrollRun = (Array.isArray(runs) ? runs : runs.data)[0]!.id;
  // The first report in the library, as a person would open it.
  const page = await browser.newPage({ storageState: ADMIN_STATE });
  await page.goto(`/o/${data.orgId}/reports`);
  const href = await page.locator(`a[href^="/o/${data.orgId}/reports/"]`).first().getAttribute('href');
  await page.close();
  ids = { payrollRun, report: href!.split('/reports/')[1]!.split('?')[0]!, project, member: data.worker.membershipId };
});

/** Row actions in the desktop table vs the stacked cards, and whether the page scrolls sideways. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const controls = (root: Element) => root.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"]').length;
    let desktop = 0;
    let mobile = 0;
    for (const td of Array.from(document.querySelectorAll('main table td[data-row-actions]'))) desktop += controls(td);
    for (const el of Array.from(document.querySelectorAll('main ul [data-row-actions]'))) mobile += controls(el);
    // Controls a person can see right now, in whichever layout this width shows.
    let visible = 0;
    for (const el of Array.from(document.querySelectorAll('main [data-row-actions]')))
      visible += Array.from(el.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"]')).filter((c) => (c as HTMLElement).getClientRects().length > 0).length;
    return { desktop, mobile, visible, overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
}

for (const vp of VIEWPORTS)
  for (const target of PAGES) {
    test(`${target.name} works on ${vp.name}`, async ({ page, data }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const path = typeof target.path === 'string' ? target.path : target.path(ids);
      await page.goto(`/o/${data.orgId}${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (target.tab)
        await page
          .getByRole('tab', { name: target.tab, exact: true })
          .or(page.getByRole('radio', { name: target.tab, exact: true }))
          .or(page.getByRole('button', { name: target.tab, exact: true }))
          .first()
          .click();
      // Let lists finish loading (skeletons gone) before measuring.
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
      const m = await measure(page);
      expect(m.overflow, `the page scrolls sideways on ${vp.name}`).toBeLessThanOrEqual(1);
      expect(m.mobile, 'row actions on the phone cards match the desktop table').toBe(m.desktop);
      expect(m.visible, `every row action is on screen on ${vp.name}`).toBe(m.desktop);
      test.info().annotations.push({ type: 'row actions', description: String(m.desktop) });
    });
  }
