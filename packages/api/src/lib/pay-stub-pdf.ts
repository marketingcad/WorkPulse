import type { PayStubDto } from '@tallywork/contracts';
import { INK, PdfDoc, TYPE, drawTable, drawTotals, fmtDate, fmtRange, hours2, money, type CompanyProfile, type TableColumn, type TableRow } from './pdf-kit';

/**
 * One pay stub (A4 portrait), in the same system as the invoice. Figures are printed as the payroll
 * line holds them; nothing is recalculated here.
 */
export async function renderPayStubPdf(stub: PayStubDto, org: CompanyProfile): Promise<Buffer> {
  const k = await PdfDoc.create({ title: `Pay stub ${stub.period_start} – ${stub.period_end}` });
  const $ = (m: number) => money(m, stub.currency);
  const paid = stub.status === 'PAID';
  await k.drawHeader(org, {
    title: 'Pay stub',
    reference: fmtRange(stub.period_start, stub.period_end),
    meta: [
      ['Pay period', fmtRange(stub.period_start, stub.period_end)],
      ['Pay group', stub.profile_name],
      ...(paid && stub.paid_at ? ([['Pay date', fmtDate(stub.paid_at)]] as Array<[string, string]>) : []),
      ['Currency', stub.currency],
    ],
    status: { key: paid ? 'PAID' : 'FINALIZED' },
  });
  k.footnote = 'Confidential: this statement is intended only for the employee named above.';

  // Employee (left) and the three figures that matter (right).
  const top = k.y;
  k.text('EMPLOYEE', k.left, k.y, { size: TYPE.label, bold: true, color: INK.slate });
  k.y -= 16;
  k.text(stub.name, k.left, k.y, { size: TYPE.body + 3, bold: true, color: INK.navy, maxWidth: 180 });
  k.y -= 13;
  k.text(stub.profile_name, k.left, k.y, { size: TYPE.body, color: INK.slate, maxWidth: 180 });
  const adj = stub.adjustments.reduce((s, a) => s + a.amount_minor, 0);
  k.y = top + 10;
  k.tiles(
    [
      { label: 'Gross pay', value: $(stub.gross_minor) },
      { label: 'Adjustments', value: adj ? `${adj < 0 ? '-' : '+'}${$(Math.abs(adj))}` : $(0) },
      { label: 'Net pay', value: $(stub.net_minor), strong: true },
    ],
    { x: k.left + 200, width: k.width - 200, perRow: 3 },
  );
  k.y -= 8;

  // Earnings.
  const cols: TableColumn[] = [
    { key: 'item', label: 'Earnings', flex: 1 },
    { key: 'hours', label: 'Hours', align: 'right', width: 80 },
    { key: 'amount', label: 'Amount', align: 'right', width: 100 },
  ];
  const earnings: TableRow[] = [{ cells: { item: 'Approved time', hours: hours2(stub.approved_seconds), amount: $(stub.time_pay_minor) } }];
  if (stub.overtime_seconds) earnings.push({ cells: { item: 'of which overtime', hours: hours2(stub.overtime_seconds), amount: '' }, indent: true, color: { item: INK.slate, hours: INK.slate } });
  if (stub.carried_seconds) earnings.push({ cells: { item: 'of which approved after an earlier payroll', hours: hours2(stub.carried_seconds), amount: '' }, indent: true, color: { item: INK.slate, hours: INK.slate } });
  if (stub.time_off_hours || stub.time_off_pay_minor) earnings.push({ cells: { item: 'Paid time off', hours: stub.time_off_hours.toFixed(2), amount: $(stub.time_off_pay_minor) } });
  earnings.push({ cells: { item: 'Gross pay', hours: '', amount: $(stub.gross_minor) }, kind: 'subtotal' });
  drawTable(k, cols, earnings, { zebra: false });

  // Adjustments: additions and deductions apart.
  if (stub.adjustments.length) {
    k.y -= 16;
    const plus = stub.adjustments.filter((a) => a.amount_minor >= 0);
    const minus = stub.adjustments.filter((a) => a.amount_minor < 0);
    const rows: TableRow[] = [];
    if (plus.length) {
      rows.push({ cells: { item: 'Additions', amount: '' }, kind: 'section' });
      for (const a of plus) rows.push({ cells: { item: a.label, amount: `+${$(a.amount_minor)}` }, color: { amount: INK.positive } });
    }
    if (minus.length) {
      rows.push({ cells: { item: 'Deductions', amount: '' }, kind: 'section' });
      for (const a of minus) rows.push({ cells: { item: a.label, amount: `-${$(-a.amount_minor)}` }, color: { amount: INK.negative } });
    }
    rows.push({ cells: { item: 'Total adjustments', amount: `${adj < 0 ? '-' : adj > 0 ? '+' : ''}${$(Math.abs(adj))}` }, kind: 'subtotal' });
    drawTable(k, [{ key: 'item', label: 'Adjustments', flex: 1 }, { key: 'amount', label: 'Amount', align: 'right', width: 100 }], rows, { zebra: false });
  }

  // Net pay.
  k.y -= 6;
  drawTotals(
    k,
    [
      { label: 'Gross pay', value: $(stub.gross_minor) },
      ...(stub.adjustments.length ? [{ label: 'Adjustments', value: `${adj < 0 ? '-' : '+'}${$(Math.abs(adj))}`, color: adj < 0 ? INK.negative : INK.positive }] : []),
      { label: 'Net pay', value: $(stub.net_minor), band: true },
    ],
    { width: 260 },
  );

  if (stub.unapproved_seconds) {
    k.y -= 8;
    k.section('Note');
    k.paragraph(`${hours2(stub.unapproved_seconds)} h in this period was not approved at the time of this payroll and is not included. It will be paid in a later payroll once approved.`, { size: TYPE.small + 0.5, color: INK.slate, width: k.width * 0.75 });
  }
  return k.finish();
}
