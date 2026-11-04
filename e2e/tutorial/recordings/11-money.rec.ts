import { request, type Page } from '@playwright/test';
import { STATE, TUTORIAL_URL } from '../env';
import { choice, expect, label, test, type Director } from '../kit';

const isoDay = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

/** Opens a Finance page from the sidebar, opening the group first when it is closed. */
async function openFinance(d: Director, page: Page, item: string) {
  const nav = page.getByRole('complementary', { name: 'Primary' });
  const group = nav.getByRole('button', { name: 'Finance' });
  if ((await group.getAttribute('aria-expanded')) !== 'true') await d.click(group, { settle: false });
  await d.click(nav.getByRole('link', { name: item }));
}

test('11.1', async ({ d, page }) => {
  await d.go('');
  d.begin();
  await openFinance(d, page, 'Rates');
  await d.point(page.getByText('Bill rates (charged to clients)'), { hold: 2000 });
  await d.point(page.getByText('Pay rates (paid to members)'), { hold: 2000 });
  await d.click(page.getByRole('button', { name: 'Set bill rate' }), { settle: false });
  const dialog = page.getByRole('dialog', { name: 'Set rate' });
  await d.mark('zoom to the Set rate dialog', dialog);
  await d.choose(dialog.getByLabel(label('Applies to')), 'Project');
  await d.choose(dialog.getByLabel(label('Project')), 'Lumen — Spring Campaign');
  await d.type(dialog.getByLabel('Rate per hour'), '125');
  await d.set(dialog.getByLabel(label('Effective from')), isoDay(0));
  await d.click(dialog.getByRole('button', { name: 'Save rate' }), { settle: false });
  await expect(page.getByText('Rate saved')).toBeVisible();
  await d.finish();
});

test('11.2', async ({ d, page }) => {
  await d.go('/finance/billing');
  d.begin();
  await openFinance(d, page, 'Budgets');
  const healthy = page.getByText('Healthy', { exact: true }).first();
  await d.mark('zoom to the counts', healthy);
  for (const k of ['Healthy', 'Warning', 'Exceeded']) await d.point(page.getByText(k, { exact: true }).first(), { hold: 1100 });
  await d.click(page.getByRole('button', { name: 'Set budget' }).first(), { settle: false });
  const dialog = page.getByRole('dialog', { name: 'Set budget' });
  await d.mark('zoom to the Set budget dialog', dialog);
  await d.choose(dialog.getByLabel(label('Project')), 'Lumen — Spring Campaign');
  await d.choose(dialog.getByLabel(label('Type')), 'Hours');
  await d.type(dialog.getByLabel(label('Hours')), '120');
  await d.type(dialog.getByLabel(label('Warn at (%)')), '80');
  await d.click(dialog.getByRole('button', { name: 'Save budget' }), { settle: false });
  await expect(page.getByText('Budget saved')).toBeVisible();
  await d.finish();
});

test('11.3', async ({ d, page }) => {
  await d.go('/finance/budgets');
  d.begin();
  await openFinance(d, page, 'Expenses');
  await d.click(page.getByRole('button', { name: /^Submitted/ }), { settle: false });
  await d.beat(1500);
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Approve' }) }).first();
  await d.point(row, { hold: 2000 });
  const view = row.getByRole('link', { name: 'View' });
  if (await view.isVisible()) await d.point(view, { hold: 1500 });
  await d.mark('highlight the Approve button', row.getByRole('button', { name: 'Approve' }));
  await d.click(row.getByRole('button', { name: 'Approve' }), { settle: false });
  await expect(page.getByText('Expense approved')).toBeVisible();
  await d.click(page.getByRole('button', { name: /^Approved/ }), { settle: false });
  await d.beat(1500);
  const reimburse = page.getByRole('button', { name: 'Reimburse' }).first();
  if (await reimburse.isVisible()) await d.point(reimburse, { hold: 2000 });
  await d.point(page.getByRole('button', { name: 'New expense' }), { hold: 1500 });
  const exp = page.getByRole('button', { name: 'Export' });
  await d.mark('highlight the Export button', exp);
  await d.point(exp, { hold: 2000 });
  await d.finish();
});

test('11.4', async ({ d, page }) => {
  await d.go('/finance/expenses');
  d.begin();
  await openFinance(d, page, 'Invoices');
  for (const k of ['Outstanding', 'Overdue', 'Drafts', 'Collected']) await d.point(page.getByText(k, { exact: true }).first(), { hold: 1000 });
  await d.click(page.getByRole('button', { name: 'New invoice' }).or(page.getByRole('link', { name: 'New invoice' })).first());
  await expect(page.getByRole('heading', { level: 1, name: 'New invoice' })).toBeVisible();
  await d.choose(page.getByLabel(label('Client')), 'Wonka Confectionery');
  await d.set(page.getByLabel(label('Period start')), isoDay(-30));
  await d.set(page.getByLabel(label('Period end')), isoDay(-2));
  await d.click(choice(page.getByRole('radiogroup', { name: 'Group time by' }), 'Project'), { settle: false });
  await d.click(page.getByRole('button', { name: 'Preview lines' }));
  const lines = page.getByRole('table', { name: 'Invoice lines' });
  await expect(lines).toBeVisible();
  await d.mark('zoom to the invoice lines', lines);
  await d.point(lines, { hold: 3500 });
  await d.click(page.getByRole('button', { name: 'Dates & notes', exact: true }));
  await d.beat(2000);
  await d.click(page.getByRole('button', { name: 'Review', exact: true }));
  const total = page.getByText('Total', { exact: true }).last();
  await d.mark('zoom to the Review totals', total);
  await d.point(total, { hold: 2500 });
  await d.click(page.getByRole('button', { name: 'Create draft invoice' }));
  await expect(page.getByText(/Invoice .+ created/)).toBeVisible();
  await d.finish();
});

test('11.5', async ({ d, page }) => {
  await d.go('/finance/invoices');
  await d.click(page.getByRole('button', { name: /^Draft/ }), { settle: false });
  await d.click(page.getByRole('row').filter({ hasText: 'Wonka Confectionery' }).first());
  await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible();
  d.begin();
  await d.point(page.getByRole('link', { name: 'Download PDF' }), { hold: 2500 });
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await d.mark('highlight the Send button', send);
  await d.click(send, { settle: false });
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).last();
  await d.beat(1500);
  await d.click(confirm.getByRole('button', { name: /^(Send invoice|Mark as sent)$/ }));
  await d.click(page.getByRole('button', { name: 'Record payment' }), { settle: false });
  const pay = page.getByRole('dialog', { name: 'Record payment' });
  await d.mark('zoom to the Record payment dialog', pay);
  await d.point(pay.getByLabel(/Amount/).first(), { hold: 1500 });
  await d.choose(pay.getByLabel(label('Method')), 'Bank transfer');
  await d.type(pay.getByLabel(label('Reference')), 'ACH-20931');
  await d.click(pay.getByRole('button', { name: 'Record payment' }), { settle: false });
  await expect(page.getByText('Payment recorded')).toBeVisible();
  await d.beat(1500);
  await d.go('/finance/invoices');
  await d.click(page.getByRole('navigation', { name: 'Invoices' }).getByRole('link', { name: 'Payments received' }));
  await d.beat(2500);
  await d.finish();
});

test('11.6', async ({ d, page }) => {
  // A weekly pay group for everyone, so the scene can pay a fully approved week.
  const admin = await request.newContext({ baseURL: TUTORIAL_URL, storageState: STATE.admin, extraHTTPHeaders: { Origin: TUTORIAL_URL } });
  const o = (p: string) => `/api/v1/orgs/${d.data.orgId}${p}`;
  const groups = await (await admin.get(o('/payroll/profiles'))).json();
  if (!(Array.isArray(groups) ? groups : groups.data).some((g: { name: string }) => g.name === 'Weekly USD')) {
    const w = await (await admin.get(o('/workers?limit=200'))).json();
    const ids = (Array.isArray(w) ? w : w.data).filter((m: { role_key: string }) => m.role_key !== 'SYSTEM_ADMIN').map((m: { id: string }) => m.id);
    const res = await admin.post(o('/payroll/profiles'), { data: { name: 'Weekly USD', period: { type: 'weekly' }, currency: 'USD', member_ids: ids } });
    expect(res.ok(), await res.text()).toBe(true);
  }
  // A draft left by an interrupted recording would overlap the new one, which payroll refuses.
  const runs = await (await admin.get(o('/payroll/runs'))).json();
  for (const r of (Array.isArray(runs) ? runs : runs.data) as Array<{ id: string; status: string }>) if (r.status === 'DRAFT') await admin.delete(o(`/payroll/runs/${r.id}`));
  await admin.dispose();

  await d.go('/finance/invoices');
  d.begin();
  await openFinance(d, page, 'Payroll');
  await d.click(choice(page.getByRole('main'), 'Pay groups'), { settle: false });
  await d.point(page.getByText('Weekly USD').first(), { hold: 2500 });
  await d.click(choice(page.getByRole('main'), 'Payrolls'), { settle: false });
  await d.click(page.getByRole('button', { name: 'Run payroll' }).last(), { settle: false });
  const dialog = page.getByRole('dialog', { name: 'Run payroll' });
  await d.choose(dialog.getByLabel(label('Pay group')), 'Weekly USD');
  await d.set(dialog.getByLabel(label('Period')), isoDay(-14));
  await d.click(dialog.getByRole('button', { name: 'Create draft' }));
  const stubs = page.getByText('Pay stubs', { exact: true }).first();
  await expect(stubs).toBeVisible();
  for (const k of ['Gross', 'Adjustments', 'Net pay']) await d.point(page.getByText(k, { exact: true }).first(), { hold: 1000 });
  await d.mark('zoom to the pay stubs table', stubs);
  await d.scrollTo(stubs);
  await d.beat(1500);
  // The bonus goes to someone who worked this week; a $0.00 stub would look odd on screen.
  const paid = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Adjust', exact: true }) }).filter({ hasNotText: /\$0\.00/ });
  await d.click(paid.first().getByRole('button', { name: 'Adjust', exact: true }), { settle: false });
  const adj = page.getByRole('dialog', { name: /Bonuses and deductions/ });
  await d.mark('zoom to the bonuses dialog', adj);
  const addLine = adj.getByRole('button', { name: 'Add line' });
  if ((await adj.getByLabel(/^Label/).count()) === 0) await d.click(addLine, { settle: false });
  await d.type(adj.getByLabel(/^Label/).last(), 'Performance bonus');
  await d.type(adj.getByLabel(/Amount/).last(), '150');
  await d.click(adj.getByRole('button', { name: 'Save' }), { settle: false });
  await expect(adj).toBeHidden();
  const finalize = page.getByRole('button', { name: 'Finalize' });
  await d.scroll(-2000);
  await d.mark('highlight the Finalize button', finalize);
  await d.click(finalize, { settle: false });
  await d.beat(2000);
  await d.click(page.getByRole('button', { name: 'Finalize' }).last());
  await expect(page.getByText(/Payroll finalized/)).toBeVisible();
  await d.finish();
});

test('11.7', async ({ d, page }) => {
  await d.go('/finance/payroll');
  await d.click(page.getByRole('row').filter({ hasText: 'Weekly USD' }).first());
  d.begin();
  const stub = page.getByRole('link', { name: 'Stub' }).first();
  await d.scrollTo(stub);
  await d.mark('highlight the Stub link', stub);
  await d.point(stub, { hold: 2500 });
  await d.scroll(-2000);
  await d.click(page.getByRole('button', { name: 'Mark as paid' }), { settle: false });
  await d.beat(1500);
  await d.click(page.getByRole('button', { name: 'Mark as paid' }).last());
  await expect(page.getByText('Payroll marked as paid')).toBeVisible();
  await d.go('/finance/payroll?tab=owed');
  const owed = page.getByText('Estimated owed', { exact: true }).first();
  await d.mark('zoom to the Owed totals', owed);
  for (const k of ['Tracked', 'Approved', 'Estimated owed', 'Approved owed']) await d.point(page.getByText(k, { exact: true }).first(), { hold: 1300 });
  await d.finish();
});
