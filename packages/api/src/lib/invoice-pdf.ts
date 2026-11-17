import { INK, PdfDoc, TYPE, drawTable, drawTotals, fmtDate, fmtRange, money, type CompanyProfile, type TableColumn, type TableRow } from './pdf-kit';

// The document system lives in pdf-kit; these stay importable from here for existing callers.
export { DOC_LOGO_BOX, SQUARE_LOGO_SIZE, drawCompanyLogo, fitLogo, winAnsi, type CompanyProfile } from './pdf-kit';

interface InvoiceView {
  number: string;
  status: string;
  issue_date: string;
  due_date: string;
  period_start: string | null;
  period_end: string | null;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  paid_minor: number;
  balance_minor: number;
  notes: string | null;
  client: { name: string; email: string | null; address: string | null; contact_name?: string | null };
  lines: Array<{ description: string; quantity: number; unit_price_minor: number; amount_minor: number; tax_minor: number }>;
}

/** A line quantity as the invoice prices it: up to 4 decimals, at least 2 (F10: 0.1667 h, not 0.17). */
export function formatQuantity(q: number): string {
  return q.toFixed(4).replace(/0{1,2}$/, '');
}

/**
 * The invoice (A4 portrait). Every figure is printed as the invoice holds it: nothing is
 * recalculated here, so the PDF always agrees with the app and with the invoice email.
 */
export async function renderInvoicePdf(inv: InvoiceView, org: CompanyProfile): Promise<Buffer> {
  const k = await PdfDoc.create({ title: `Invoice ${inv.number}` });
  const $ = (m: number) => money(m, inv.currency);
  const meta: Array<[string, string]> = [
    ['Invoice no.', inv.number],
    ['Issue date', fmtDate(inv.issue_date)],
    ['Due date', fmtDate(inv.due_date)],
  ];
  if (inv.period_start) meta.push(['Service period', fmtRange(inv.period_start, inv.period_end)]);
  await k.drawHeader(org, { title: 'Invoice', reference: inv.number, meta, status: { key: inv.status } });
  k.footnote = inv.status === 'VOID' ? `This invoice has been voided and is no longer payable.` : `Please quote ${inv.number} with your payment.${org.email ? ` Questions about this invoice: ${org.email}.` : ''}`;

  // Bill to (left) and the amount due (right).
  const top = k.y;
  const boxW = 210;
  const leftW = k.width - boxW - 24;
  k.text('BILL TO', k.left, k.y, { size: TYPE.label, bold: true, color: INK.slate });
  k.y -= 15;
  for (const l of k.wrap(inv.client.name, leftW, TYPE.body + 2, true)) {
    k.text(l, k.left, k.y, { size: TYPE.body + 2, bold: true, color: INK.navy });
    k.y -= 14;
  }
  const details = [inv.client.contact_name ? `Attn: ${inv.client.contact_name}` : null, ...(inv.client.address ?? '').split('\n'), inv.client.email].map((s) => s?.trim()).filter((s): s is string => !!s);
  for (const d of details.slice(0, 7)) {
    for (const l of k.wrap(d, leftW, TYPE.body)) {
      k.text(l, k.left, k.y, { size: TYPE.body, color: INK.slate });
      k.y -= 12;
    }
  }
  const leftBottom = k.y;
  const boxH = 74;
  const bx = k.right - boxW;
  const voided = inv.status === 'VOID';
  k.rect(bx, top - boxH + 10, boxW, boxH, voided ? INK.panel : INK.navy);
  const light = voided ? INK.slate : INK.white;
  k.text(voided ? 'VOIDED' : inv.balance_minor === 0 && inv.total_minor > 0 ? 'PAID IN FULL' : 'AMOUNT DUE', bx + 14, top - 6, { size: TYPE.label, bold: true, color: voided ? INK.negative : INK.white });
  k.text($(inv.balance_minor), bx + 14, top - 32, { size: 22, bold: true, color: voided ? INK.slate : INK.white, maxWidth: boxW - 28 });
  k.text(inv.balance_minor > 0 && !voided ? `Due ${fmtDate(inv.due_date)}` : `Invoice total ${$(inv.total_minor)}`, bx + 14, top - 50, { size: TYPE.small, color: light });
  k.y = Math.min(leftBottom, top - boxH + 10) - 26;

  // Line items.
  const taxed = inv.lines.some((l) => l.tax_minor);
  const cols: TableColumn[] = [
    { key: 'desc', label: 'Description', flex: 1 },
    { key: 'qty', label: 'Qty', align: 'right', width: 62 },
    { key: 'rate', label: 'Rate', align: 'right', width: 82 },
    ...(taxed ? [{ key: 'tax', label: 'Tax', align: 'right' as const, width: 72 }] : []),
    { key: 'amount', label: 'Amount', align: 'right', width: 92 },
  ];
  const rows: TableRow[] = inv.lines.map((l) => ({
    cells: { desc: l.description, qty: formatQuantity(l.quantity), rate: $(l.unit_price_minor), tax: $(l.tax_minor), amount: $(l.amount_minor) },
  }));
  drawTable(k, cols, rows, { empty: 'No line items.' });

  // Totals.
  k.y -= 6;
  drawTotals(k, [
    { label: 'Subtotal', value: $(inv.subtotal_minor) },
    ...(inv.tax_minor ? [{ label: 'Tax', value: $(inv.tax_minor) }] : []),
    { label: 'Total', value: $(inv.total_minor), strong: true },
    ...(inv.paid_minor ? [{ label: 'Less amount paid', value: `-${$(inv.paid_minor)}`, color: INK.positive }] : []),
    { label: voided ? 'Balance due (void)' : 'Balance due', value: $(inv.balance_minor), band: true, muted: voided },
  ]);

  // Notes, in full.
  if (inv.notes?.trim()) {
    k.y -= 10;
    k.section('Notes');
    k.paragraph(inv.notes.trim(), { size: TYPE.body, color: INK.charcoal, width: k.width * 0.72 });
  }
  if (voided) k.watermark('VOID');
  return k.finish();
}
