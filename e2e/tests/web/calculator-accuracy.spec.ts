import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../support/fixtures';
import { ADMIN_STATE } from '../../support/env';

/**
 * Accuracy of the calculator's output, typed into the real panel. Each expected value is worked out by
 * hand in the comment beside it. The last test checks the calculator against WorkPulse's own payroll.
 */
test.use({ storageState: ADMIN_STATE });

const result = (p: Locator, label: string) => p.getByRole('term').filter({ hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd');

async function open(page: Page, orgId: string, mode: 'Hours' | 'Pay' | 'Convert') {
  await page.goto(`/o/${orgId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Open calculator' }).click();
  const p = page.getByRole('dialog', { name: 'Calculator' });
  await p.getByRole('radio', { name: mode }).click();
  return p;
}

const SHIFTS: Array<{ name: string; start: string; end: string; brk: string; worked: string; decimal: string; overnight?: boolean }> = [
  { name: 'a day with an hour for lunch', start: '09:00', end: '17:00', brk: '1:00', worked: '7:00', decimal: '7.00' }, // 8:00 − 1:00
  { name: 'quarter hours with a break in minutes', start: '08:45', end: '17:15', brk: '30m', worked: '8:00', decimal: '8.00' }, // 8:30 − 0:30
  { name: 'a break in decimal hours', start: '07:10', end: '15:55', brk: '0.75', worked: '8:00', decimal: '8.00' }, // 8:45 − 0:45
  { name: 'a short shift past midnight', start: '23:30', end: '00:15', brk: '', worked: '0:45', decimal: '0.75', overnight: true }, // 0:30 + 0:15
  { name: 'a night shift', start: '22:00', end: '06:30', brk: '0:30', worked: '8:00', decimal: '8.00', overnight: true }, // 8:30 − 0:30
  { name: 'the longest day', start: '00:00', end: '23:59', brk: '', worked: '23:59', decimal: '23.98' }, // 1,439 min = 23.983 h
];

test.describe('calculator accuracy: hours', () => {
  for (const s of SHIFTS) {
    test(`${s.name}: ${s.start}–${s.end}, break ${s.brk || 'none'} → ${s.worked}`, async ({ page, data }) => {
      const p = await open(page, data.orgId, 'Hours');
      const shift = p.getByRole('group', { name: 'Shift' });
      await shift.getByLabel('Start').fill(s.start);
      await shift.getByLabel('End').fill(s.end);
      if (s.brk) await shift.getByLabel('Break').fill(s.brk);
      await expect(shift.getByText(`${s.worked} worked${s.overnight ? ', past midnight' : ''}`, { exact: true })).toBeVisible();
      await expect(result(p, 'Total worked')).toHaveText(s.worked);
      await expect(result(p, 'In decimal hours')).toHaveText(s.decimal);
    });
  }

  test('three shifts add up to 8:00 and carry over to pay', async ({ page, data }) => {
    const p = await open(page, data.orgId, 'Hours');
    const rows: Array<[string, string]> = [['09:00', '12:00'], ['13:00', '17:20'], ['18:00', '18:40']]; // 3:00 + 4:20 + 0:40
    // Shifts are numbered once there is more than one: add them all, then fill each.
    for (let i = 1; i < rows.length; i++) await p.getByRole('button', { name: 'Add shift' }).click();
    for (const [i, [start, end]] of rows.entries()) {
      const shift = p.getByRole('group', { name: `Shift ${i + 1}` });
      await shift.getByLabel('Start').fill(start);
      await shift.getByLabel('End').fill(end);
    }
    await expect(result(p, 'Total worked')).toHaveText('8:00');
    await p.getByRole('button', { name: 'Work out pay for these hours' }).click();
    await expect(p.getByLabel('Hours')).toHaveValue('8:00');
    await p.getByLabel(/^Pay rate per hour/).fill('22.75');
    await expect(result(p, 'Pay')).toHaveText('$182.00'); // 8 × 22.75
  });
});

const PAY: Array<{ name: string; hours: string; pay: string; bill?: string; want: { pay: string; bill?: string; margin?: string } }> = [
  { name: 'a full day', hours: '8:00', pay: '75.50', bill: '120', want: { pay: '$604.00', bill: '$960.00', margin: '$356.00' } }, // 8 × 75.50; 8 × 120
  { name: 'hours and minutes that do not divide evenly', hours: '7h 20m', pay: '33.33', want: { pay: '$244.42' } }, // 26,400 s × 3,333 ¢ / 3,600 = 24,442 ¢
  { name: 'one minute rounds up from 16.67 cents', hours: '1m', pay: '10', want: { pay: '$0.17' } }, // 1,000 ¢ / 60 = 16.67 ¢
  { name: 'an exact half cent rounds up', hours: '1m', pay: '0.30', want: { pay: '$0.01' } }, // 30 ¢ / 60 = 0.5 ¢
  { name: 'a rate with a thousands separator', hours: '37.5', pay: '1,250.00', want: { pay: '$46,875.00' } }, // 37.5 × 1,250
  { name: 'billing below cost shows a negative margin', hours: '2:45', pay: '18.40', bill: '15', want: { pay: '$50.60', bill: '$41.25', margin: '-$9.35' } }, // 2.75 × 18.40; 2.75 × 15
  { name: 'large hours and rate', hours: '99:59', pay: '999.99', want: { pay: '$99,982.33' } }, // 359,940 s × 99,999 ¢ / 3,600 = 9,998,233.35 ¢
  { name: 'zero rate', hours: '8', pay: '0', bill: '0.00', want: { pay: '$0.00', bill: '$0.00', margin: '$0.00' } },
];

test.describe('calculator accuracy: pay and bill', () => {
  for (const c of PAY) {
    test(`${c.name}: ${c.hours} × ${c.pay}${c.bill ? ` (bill ${c.bill})` : ''} → ${c.want.pay}`, async ({ page, data }) => {
      const p = await open(page, data.orgId, 'Pay');
      await p.getByLabel('Hours').fill(c.hours);
      await p.getByLabel(/^Pay rate per hour/).fill(c.pay);
      if (c.bill) await p.getByLabel(/^Bill rate per hour/).fill(c.bill);
      await expect(result(p, 'Pay')).toHaveText(c.want.pay);
      await expect(result(p, 'Bill')).toHaveText(c.want.bill ?? '—');
      await expect(result(p, 'Margin')).toHaveText(c.want.margin ?? '—');
    });
  }
});

const CONVERT: Array<[typed: string, hm: string, decimal: string, minutes: string]> = [
  ['7:45', '7:45', '7.75', '465'],
  ['90m', '1:30', '1.50', '90'],
  ['2h 5m', '2:05', '2.08', '125'], // 125 / 60 = 2.083
  ['0.1', '0:06', '0.10', '6'],
  ['10.99', '10:59', '10.99', '659'], // 39,564 s = 659.4 min
  ['0:00', '0:00', '0.00', '0'],
];

test.describe('calculator accuracy: conversions', () => {
  test('each duration in H:MM, decimal hours and minutes', async ({ page, data }) => {
    const p = await open(page, data.orgId, 'Convert');
    for (const [typed, hm, decimal, minutes] of CONVERT) {
      await test.step(`${typed} → ${hm} / ${decimal} / ${minutes} min`, async () => {
        await p.getByLabel('Hours').fill(typed);
        await expect(result(p, 'Hours and minutes')).toHaveText(hm);
        await expect(result(p, 'Decimal hours')).toHaveText(decimal);
        await expect(result(p, 'Minutes')).toHaveText(minutes);
      });
    }
  });
});

test.describe('calculator accuracy: matches WorkPulse payroll', () => {
  test("Wade's payroll line: the calculator gives the same time pay", { tag: '@smoke' }, async ({ page, data }) => {
    // The seeded payroll pays Wade 3 h of approved time at $25/h (support/global-setup.ts).
    await page.goto(`/o/${data.orgId}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const runs = (await (await page.request.get(`/api/v1/orgs/${data.orgId}/payroll/runs`)).json()) as Array<{ id: string }>;
    let line: { approved_seconds: number; time_pay_minor: number } | undefined;
    for (const run of runs) {
      const detail = (await (await page.request.get(`/api/v1/orgs/${data.orgId}/payroll/runs/${run.id}`)).json()) as { lines?: Array<{ membership_id: string; approved_seconds: number; time_pay_minor: number }> };
      line = detail.lines?.find((l) => l.membership_id === data.worker.membershipId) ?? line;
    }
    expect(line, "Wade's payroll line").toBeDefined();
    expect(line!.approved_seconds % 60, 'whole minutes, so the hours can be typed exactly').toBe(0);
    const minutes = line!.approved_seconds / 60;
    const typed = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    const payrollPay = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(line!.time_pay_minor / 100);

    await page.getByRole('button', { name: 'Open calculator' }).click();
    const p = page.getByRole('dialog', { name: 'Calculator' });
    await p.getByRole('radio', { name: 'Pay' }).click();
    await p.getByLabel('Hours').fill(typed);
    await p.getByLabel(/^Pay rate per hour/).fill('25');
    await expect(result(p, 'Pay')).toHaveText(payrollPay);
    expect(payrollPay).toBe('$75.00'); // 3 h × $25
  });
});
