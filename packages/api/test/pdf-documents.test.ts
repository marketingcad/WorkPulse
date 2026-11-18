import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PayStubDto } from '@tallywork/contracts';
import { renderInvoicePdf } from '../src/lib/invoice-pdf';
import { renderPayStubPdf } from '../src/lib/pay-stub-pdf';
import { formatPdfCell, planColumns, toPdf } from '../src/lib/export';
import { fmtDate, fmtRange, money, winAnsi } from '../src/lib/pdf-kit';
import type { ReportResult } from '../src/services/reports';
import { Client, addMember, createHarness, signup, type Harness } from './harness';
import { flat, readPdf, type PdfText } from './pdf-text';

/**
 * The finance documents (invoice, pay stub, report exports) after the redesign: every figure the
 * data holds is printed, exactly; nothing is cut off or runs past the margins; long documents break
 * across pages with the table header repeated and "Page X of Y" on every page.
 */

const company = { name: 'E-Systems Management', brief: 'Remote staffing', address: '12 Harbour Street\nSingapore 049712', phone: '+65 6000 0000', email: 'billing@esm.test', taxId: 'SG-1' };

/** Every text run stays inside the page margins (left/right) and above the page bottom. */
function insideMargins(p: PdfText, left: number, right: number) {
  const out = p.runs.filter((r) => r.x < left - 0.6 || r.x + r.width > p.size[r.page - 1]!.width - right + 0.6 || r.y < 18 || r.y > p.size[r.page - 1]!.height - 18);
  return out.map((r) => `p${r.page} "${r.text}" x=${r.x.toFixed(1)} w=${r.width.toFixed(1)} y=${r.y.toFixed(1)}`);
}

function invoice(lines: number, o: Partial<{ status: string; tax: number; paidShare: number; notes: string | null; client: string; longDesc: string }> = {}) {
  const ls = Array.from({ length: lines }, (_, i) => {
    const quantity = [1.2422, 12, 7.5, 3][i % 4]!;
    const unit_price_minor = [10000, 8500, 12000, 6000][i % 4]!;
    const amount_minor = Math.round(quantity * unit_price_minor);
    return { description: i === 1 && o.longDesc ? o.longDesc : `Line ${i + 1}: QA-AUDIT Project — consulting`, quantity, unit_price_minor, amount_minor, tax_minor: Math.round((amount_minor * (o.tax ?? 0)) / 10000) };
  });
  const subtotal_minor = ls.reduce((s, l) => s + l.amount_minor, 0);
  const tax_minor = ls.reduce((s, l) => s + l.tax_minor, 0);
  const total_minor = subtotal_minor + tax_minor;
  const paid_minor = Math.round(total_minor * (o.paidShare ?? 0));
  return {
    number: 'INV-2042',
    status: o.status ?? 'SENT',
    issue_date: '2026-11-18',
    due_date: '2026-12-18',
    period_start: '2026-11-16',
    period_end: '2026-11-22',
    currency: 'USD',
    subtotal_minor,
    tax_minor,
    total_minor,
    paid_minor,
    balance_minor: total_minor - paid_minor,
    notes: o.notes === undefined ? 'Thank you for your business.\nBank transfer: account 0123456789.' : o.notes,
    client: { name: o.client ?? 'Northwind Traders Pte. Ltd.', email: 'ap@northwind.test', address: '88 Market Street\nSingapore 048948', contact_name: 'Dana Whitfield' },
    lines: ls,
  };
}

describe('formatting helpers', () => {
  it('money has separators, two decimals and a sign before the symbol', () => {
    expect(money(123456789, 'USD')).toBe('$1,234,567.89');
    expect(money(-1500, 'USD')).toBe('-$15.00');
    expect(money(0, 'EUR')).toBe('€0.00');
  });
  it('dates are spelled out, ranges share the year', () => {
    expect(fmtDate('2026-11-18')).toBe('Nov 18, 2026');
    expect(fmtRange('2026-11-16', '2026-11-22')).toBe('Nov 16 – Nov 22, 2026');
    expect(fmtRange('2026-12-28', '2027-01-03')).toBe('Dec 28, 2026 – Jan 3, 2027');
  });
  it('text the PDF font cannot show keeps its letters instead of failing', () => {
    expect(winAnsi('Zażółć Gęślą Łódź')).toBe('Zazólc Gesla Lódz');
    expect(winAnsi('Œuvre Šárka — “quoted” €5')).toBe('Œuvre Šárka — “quoted” €5');
    expect(winAnsi('5 − 3')).toBe('5 - 3');
    expect(winAnsi('東京')).toBe('??');
  });
});

describe('invoice PDF', () => {
  it('prints every figure exactly as the invoice holds it', async () => {
    const inv = invoice(3, { tax: 1000, paidShare: 0.5, status: 'PARTIALLY_PAID' });
    const p = await readPdf(await renderInvoicePdf(inv, company));
    const text = flat(p.all);
    for (const s of ['INVOICE', 'INV-2042', 'Northwind Traders Pte. Ltd.', 'Attn: Dana Whitfield', 'Nov 18, 2026', 'Dec 18, 2026', 'Nov 16 – Nov 22, 2026', 'E-Systems Management', 'Tax ID SG-1']) expect(text).toContain(s);
    for (const l of inv.lines) {
      expect(text).toContain(l.description);
      expect(text).toContain(money(l.amount_minor, 'USD'));
      expect(text).toContain(money(l.tax_minor, 'USD'));
    }
    for (const m of [inv.subtotal_minor, inv.tax_minor, inv.total_minor, inv.balance_minor]) expect(text).toContain(money(m, 'USD'));
    expect(text).toContain(`-${money(inv.paid_minor, 'USD')}`);
    expect(text).toContain('PARTIALLY PAID');
    expect(text).toContain('Page 1 of 1');
    expect(text).toContain('Please quote INV-2042 with your payment.');
  });

  it('wraps a long description and long notes instead of cutting them', async () => {
    const longDesc = 'Platform engineering: migration of the reporting pipeline to the new data warehouse, including validation of every historical figure and a hand-over session with the finance team';
    const notes = Array.from({ length: 14 }, (_, i) => `Note line ${i + 1}: payment terms, bank details and the remittance address for the accounts payable team.`).join('\n');
    const p = await readPdf(await renderInvoicePdf(invoice(3, { longDesc, notes }), company));
    expect(flat(p.all)).toContain(longDesc);
    for (let i = 1; i <= 14; i++) expect(flat(p.all)).toContain(`Note line ${i}: payment terms, bank details and the remittance address for the accounts payable team.`);
    expect(p.all).not.toContain('…');
    expect(insideMargins(p, 48, 48)).toEqual([]);
  });

  it('breaks a long invoice across pages with the header repeated and totals once at the end', async () => {
    const inv = invoice(70);
    const p = await readPdf(await renderInvoicePdf(inv, company));
    expect(p.pages).toBeGreaterThan(1);
    for (let n = 1; n <= p.pages; n++) {
      expect(p.page(n)).toContain(`Page ${n} of ${p.pages}`);
      expect(p.page(n)).toContain('DESCRIPTION');
      if (n > 1) expect(p.page(n)).toContain('INV-2042  ·  continued');
    }
    for (const l of inv.lines) expect(flat(p.all)).toContain(l.description);
    expect(p.all.match(/BALANCE DUE/g)).toHaveLength(1);
    expect(p.page(p.pages)).toContain('BALANCE DUE');
    expect(insideMargins(p, 48, 48)).toEqual([]);
    // No row is drawn into the footer area.
    expect(p.runs.filter((r) => r.y < 64 && !/^Page |E-Systems Management|Please quote/.test(r.text))).toEqual([]);
  });

  it('marks a void invoice on every page and says it is not payable', async () => {
    const p = await readPdf(await renderInvoicePdf(invoice(2, { status: 'VOID' }), { name: 'Acme Ltd' }));
    expect(p.all).toContain('VOID');
    expect(p.all).toContain('VOIDED');
    expect(p.all).toContain('no longer payable');
  });

  it('a client name in any script still produces the invoice', async () => {
    const p = await readPdf(await renderInvoicePdf(invoice(1, { client: 'Łódź Studio 東京' }), { name: 'Zażółć Ltd' }));
    expect(p.all).toContain('Lódz Studio ??');
    expect(p.all).toContain('Zazólc Ltd');
  });

  it('leaves out the tax column when nothing is taxed', async () => {
    expect((await readPdf(await renderInvoicePdf(invoice(2), company))).all).not.toMatch(/^TAX$/m);
    expect((await readPdf(await renderInvoicePdf(invoice(2, { tax: 500 }), company))).all).toMatch(/^TAX$/m);
  });
});

describe('pay stub PDF', () => {
  const stub: PayStubDto = {
    id: 's',
    run_id: 'r',
    membership_id: 'm',
    name: 'QA Worker Wes',
    profile_name: 'QA-AUDIT Weekly USD',
    period_start: '2026-11-09',
    period_end: '2026-11-15',
    currency: 'USD',
    status: 'PAID',
    approved_seconds: 37800,
    unapproved_seconds: 3600,
    carried_seconds: 1800,
    regular_seconds: 36000,
    overtime_seconds: 1800,
    time_pay_minor: 26875,
    time_off_hours: 8,
    time_off_pay_minor: 20000,
    gross_minor: 46875,
    adjustments: [
      { label: 'Performance bonus', amount_minor: 2000 },
      { label: 'Equipment advance repayment', amount_minor: -1500 },
    ],
    net_minor: 47375,
    paid_at: '2026-11-18T09:30:00Z',
    warnings: [],
  };

  it('prints earnings, additions and deductions apart, and the net pay', async () => {
    const p = await readPdf(await renderPayStubPdf(stub, company));
    const t = flat(p.all);
    for (const s of ['PAY STUB', 'QA Worker Wes', 'Nov 9 – Nov 15, 2026', 'QA-AUDIT Weekly USD', 'Nov 18, 2026', 'PAID', 'Approved time', '10.50', '$268.75', 'of which overtime', '0.50', 'of which approved after an earlier payroll', 'Paid time off', '8.00', '$200.00', '$468.75', 'Additions', '+$20.00', 'Deductions', '-$15.00', 'Total adjustments', '+$5.00', 'NET PAY', '$473.75', 'Page 1 of 1']) expect(t).toContain(s);
    expect(t).toContain('1.00 h in this period was not approved');
    expect(t).toContain('Confidential');
    expect(insideMargins(p, 48, 48)).toEqual([]);
  });

  it('a stub without adjustments or notes stays simple', async () => {
    const p = await readPdf(await renderPayStubPdf({ ...stub, adjustments: [], unapproved_seconds: 0, carried_seconds: 0, overtime_seconds: 0, time_off_hours: 0, time_off_pay_minor: 0, gross_minor: 26875, net_minor: 26875, status: 'FINALIZED', paid_at: null }, company));
    expect(p.all).not.toContain('Deductions');
    expect(p.all).not.toContain('NOTE');
    expect(p.all).toContain('FINALIZED');
    expect(p.all).not.toContain('PAY DATE');
  });
});

describe('report PDF', () => {
  const opts = { company, from: '2026-11-01', to: '2026-11-30', generatedAt: new Date('2026-11-18T09:45:00Z'), timezone: 'Asia/Singapore' };
  const owed = (n: number): ReportResult & { title: string } => {
    const rows = Array.from({ length: n }, (_, i) => ({ worker_name: i % 3 === 0 ? `Zażółć Gęślą ${i}` : `Member ${i}`, tracked_seconds: 16200 + i * 900, approved_amount_minor: 112550 + i * 1250 }));
    return {
      title: 'Payroll export',
      currency: 'USD',
      columns: [
        { key: 'worker_name', label: 'Member', type: 'text' },
        { key: 'tracked_seconds', label: 'Tracked', type: 'duration' },
        { key: 'approved_amount_minor', label: 'Owed (approved)', type: 'money' },
      ],
      rows,
      totals: { tracked_seconds: rows.reduce((s, r) => s + r.tracked_seconds, 0), approved_amount_minor: rows.reduce((s, r) => s + r.approved_amount_minor, 0) },
      summary: [{ label: 'Owed (approved)', value: rows.reduce((s, r) => s + r.approved_amount_minor, 0), type: 'money' }],
    };
  };

  it('prints the company, period, summary, every row and the totals, with formatted money', async () => {
    const r = owed(5);
    const p = await readPdf(await toPdf(r, opts));
    const t = flat(p.all);
    for (const s of ['PAYROLL EXPORT', 'E-Systems Management', 'Nov 1 – Nov 30, 2026', 'Nov 18, 2026, 5:45 PM', '$1,125.50', 'Total', money(r.totals!.approved_amount_minor!, 'USD'), 'Page 1 of 1', 'Durations in hours:minutes']) expect(t).toContain(s);
    expect(t).toContain('Zazólc Gesla 0');
    for (const row of r.rows) expect(t).toContain(money(Number(row.approved_amount_minor), 'USD'));
    expect(t).not.toMatch(/\d USD/); // never "1125.50 USD"
    expect(insideMargins(p, 40, 40)).toEqual([]);
  });

  it('breaks long reports across pages and repeats the header row', async () => {
    const r = owed(160);
    const p = await readPdf(await toPdf(r, opts));
    expect(p.pages).toBeGreaterThan(2);
    for (let n = 1; n <= p.pages; n++) {
      expect(p.page(n)).toContain(`Page ${n} of ${p.pages}`);
      expect(p.page(n)).toContain('MEMBER');
    }
    for (const row of r.rows) expect(p.all).toContain(winAnsi(String(row.worker_name)));
    expect(p.all.match(/^Total$/gm)).toHaveLength(1);
    expect(p.page(p.pages)).toMatch(/^Total$/m);
  });

  it('fits a report with a column per day: nothing overlaps, every column is printed', async () => {
    const dates = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    const r: ReportResult & { title: string } = {
      title: 'Daily totals',
      columns: [{ key: 'worker', label: 'Member', type: 'text' }, ...dates.map((d) => ({ key: d, label: d.slice(5), type: 'duration' as const })), { key: 'total', label: 'Total', type: 'duration' }],
      rows: Array.from({ length: 6 }, (_, i) => ({ worker: `Member ${i + 1}`, ...Object.fromEntries(dates.map((d, k) => [d, 28800 - k * 60])), total: 600000 })),
      summary: [],
    };
    const p = await readPdf(await toPdf(r, opts));
    for (const d of dates) expect(p.all).toContain(d.slice(5));
    expect(p.all).toContain('Columns');
    // The Member column is repeated with every group of columns.
    expect(p.runs.filter((x) => x.text === 'Member 1').length).toBeGreaterThanOrEqual(2);
    expect(insideMargins(p, 40, 40)).toEqual([]);
    // No two runs on the same line overlap.
    for (let n = 1; n <= p.pages; n++) {
      const lines = new Map<number, typeof p.runs>();
      for (const run of p.runs.filter((x) => x.page === n)) lines.set(Math.round(run.y), [...(lines.get(Math.round(run.y)) ?? []), run]);
      for (const line of lines.values()) {
        const s = [...line].sort((a, b) => a.x - b.x);
        for (let i = 1; i < s.length; i++) expect(s[i]!.x, `"${s[i - 1]!.text}" overlaps "${s[i]!.text}" on page ${n}`).toBeGreaterThanOrEqual(s[i - 1]!.x + s[i - 1]!.width - 0.5);
      }
    }
  });

  it('keeps money in different currencies on separate totals lines', async () => {
    const r: ReportResult & { title: string } = {
      title: 'Expenses',
      currency: 'USD',
      columns: [
        { key: 'name', label: 'Item', type: 'text' },
        { key: 'amount_minor', label: 'Amount', type: 'money' },
        { key: 'currency', label: 'Currency', type: 'text' },
      ],
      rows: [
        { name: 'Hotel', amount_minor: 25000, currency: 'USD' },
        { name: 'Train', amount_minor: 8000, currency: 'EUR' },
      ],
      totalsByCurrency: [
        { currency: 'USD', totals: { amount_minor: 25000 } },
        { currency: 'EUR', totals: { amount_minor: 8000 } },
      ],
      summary: [],
    };
    const t = flat((await readPdf(await toPdf(r, opts))).all);
    for (const s of ['$250.00', '€80.00', 'Total (USD)', 'Total (EUR)']) expect(t).toContain(s);
  });

  it('says so when there is nothing to show', async () => {
    const r: ReportResult & { title: string } = { title: 'Time off', columns: [{ key: 'a', label: 'Member', type: 'text' }], rows: [], summary: [] };
    expect((await readPdf(await toPdf(r, opts))).all).toContain('No records for this period.');
  });

  it('shows statuses as words and instants in the organization’s time zone', () => {
    expect(formatPdfCell('CHANGES_REQUESTED', { key: 's', label: 'S', type: 'status' }, undefined, 'UTC')).toBe('Changes requested');
    expect(formatPdfCell('2026-11-17T16:22:00.000Z', { key: 't', label: 'T', type: 'datetime' }, undefined, 'Asia/Singapore')).toBe('Nov 18, 2026, 12:22 AM');
    expect(formatPdfCell(1234567, { key: 'n', label: 'N', type: 'number' }, undefined, 'UTC')).toBe('1,234,567');
  });

  it('plans columns: one group when they fit, otherwise groups that each repeat the first column', () => {
    const measure = (s: string, size: number) => s.length * size * 0.5;
    const cols = Array.from({ length: 40 }, (_, i) => ({ key: String(i), label: `C${i}`, type: (i ? 'duration' : 'text') as 'duration' | 'text' }));
    const narrow = planColumns(measure, cols.slice(0, 5), [['Name', '1:00', '1:00', '1:00', '1:00']], 760);
    expect(narrow.groups).toEqual([[0, 1, 2, 3, 4]]);
    const wide = planColumns(measure, cols, [cols.map((_, i) => (i ? '166:40' : 'A long member name'))], 400);
    expect(wide.groups.length).toBeGreaterThan(1);
    for (const g of wide.groups) expect(g[0]).toBe(0);
    expect(wide.groups.flatMap((g) => g.slice(1)).sort((a, b) => a - b)).toEqual(cols.slice(1).map((_, i) => i + 1));
  });
});

// The documents served by the app carry the organization's real data.
describe('served documents', () => {
  let t: Harness;
  let admin: Client;
  let orgId: string;
  const o = (p: string) => `/orgs/${orgId}${p}`;
  beforeAll(async () => {
    t = await createHarness();
    t.clock.set(new Date('2026-11-18T10:00:00Z'));
    ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@pdfdocs.test', 'Ada Consulting'));
    await addMember(t, admin, orgId, 'Walt', 'walt@pdfdocs.test');
    await admin.patch(o(''), { email: 'billing@ada.test', tax_id: 'TX-9', address: '1 Main St' });
  });
  afterAll(() => t.close());

  it('the invoice download shows the saved invoice', async () => {
    const client = (await admin.post(o('/clients'), { name: 'Contoso Ltd', email: 'ap@contoso.test' })).body.id;
    const inv = (await admin.post(o('/invoices'), { client_id: client, period_start: '2026-11-01', period_end: '2026-11-30', issue_date: '2026-11-18', due_date: '2026-12-18', extra_lines: [{ description: 'Onboarding workshop for the finance team', quantity: 2, unit_price_minor: 45000 }] })).body;
    const r = await t.app.request(`/api/v1${o(`/invoices/${inv.id}/pdf`)}`, { headers: { Cookie: admin.cookie } });
    expect(r.status).toBe(200);
    const text = flat((await readPdf(Buffer.from(await r.arrayBuffer()))).all);
    for (const s of [inv.number, 'Contoso Ltd', 'Onboarding workshop for the finance team', '$450.00', '$900.00', 'Ada Consulting', 'Tax ID TX-9', 'billing@ada.test', 'Page 1 of 1']) expect(text).toContain(s);
  });

  it('the report export PDF carries the company header and the period', async () => {
    const r = await admin.raw('POST', o('/reports/time-activity/export'), { format: 'PDF', from: '2026-11-01', to: '2026-11-30' });
    expect(r.status).toBe(200);
    const text = flat((await readPdf(Buffer.from(await r.arrayBuffer()))).all);
    for (const s of ['Ada Consulting', 'Nov 1 – Nov 30, 2026', 'Page 1 of']) expect(text).toContain(s);
  });
});
