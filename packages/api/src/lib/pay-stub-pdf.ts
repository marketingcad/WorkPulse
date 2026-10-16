import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { PayStubDto } from '@tallywork/contracts';
import { PDF, PDF_STATUS, footer, winAnsi, type CompanyProfile } from './invoice-pdf';

const hours = (s: number) => `${(s / 3600).toFixed(2)} h`;

/** One-page pay stub (A4 portrait), in the same style as the invoice. */
export async function renderPayStubPdf(stub: PayStubDto, org: CompanyProfile): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Pay stub ${stub.period_start} – ${stub.period_end}`);
  doc.setProducer('Tallywork');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { ink, muted, navy } = PDF;
  const money = (m: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: stub.currency }).format(m / 100);
  const size: [number, number] = [595, 842];
  const page = doc.addPage(size);
  const M = 48;
  let y = size[1] - M;
  const draw = (s: string, x: number, yy: number, o: { size?: number; f?: typeof font; color?: typeof ink; right?: boolean } = {}) => {
    const sz = o.size ?? 10;
    const f = o.f ?? font;
    const t = winAnsi(s);
    page.drawText(t, { x: o.right ? x - f.widthOfTextAtSize(t, sz) : x, y: yy, size: sz, font: f, color: o.color ?? ink });
  };

  page.drawRectangle({ x: 0, y: size[1] - 6, width: size[0], height: 6, color: PDF.blue });
  draw(org.name, M, y, { size: 16, f: bold, color: navy });
  draw('PAY STUB', size[0] - M, y, { size: 20, f: bold, color: navy, right: true });
  y -= 18;
  for (const line of [org.address?.split('\n')[0], org.taxId ? `Tax ID: ${org.taxId}` : null].filter((s): s is string => !!s)) {
    draw(line, M, y, { size: 8.5, color: muted });
    y -= 11;
  }
  y -= 20;
  draw('Employee', M, y, { size: 9, color: muted });
  draw('Pay period', 360, y, { size: 9, color: muted });
  draw(`${stub.period_start} – ${stub.period_end}`, size[0] - M, y, { right: true });
  y -= 14;
  draw(stub.name, M, y, { f: bold });
  draw('Payroll', 360, y, { size: 9, color: muted });
  draw(stub.profile_name, size[0] - M, y, { right: true });
  y -= 14;
  draw('Status', 360, y, { size: 9, color: muted });
  const pill = PDF_STATUS[stub.status === 'PAID' ? 'PAID' : 'FINALIZED']!;
  const label = stub.status === 'PAID' ? `PAID${stub.paid_at ? ` ${stub.paid_at.slice(0, 10)}` : ''}` : pill.label;
  const pw = bold.widthOfTextAtSize(label, 7.5) + 14;
  page.drawRectangle({ x: size[0] - M - pw, y: y - 3.5, width: pw, height: 14, color: pill.bg });
  draw(label, size[0] - M - 7, y, { size: 7.5, f: bold, color: pill.fg, right: true });
  y -= 34;

  const row = (label: string, detail: string, amount: string, strong = false) => {
    draw(label, M, y, { f: strong ? bold : font });
    draw(detail, 380, y, { color: muted, right: true });
    draw(amount, size[0] - M, y, { f: strong ? bold : font, right: true });
    y -= 18;
  };
  page.drawRectangle({ x: M - 8, y: y - 8, width: size[0] - 2 * M + 16, height: 24, color: PDF.tint });
  draw('EARNINGS', M, y, { size: 8, f: bold, color: navy });
  draw('HOURS', 380, y, { size: 8, f: bold, color: navy, right: true });
  draw('AMOUNT', size[0] - M, y, { size: 8, f: bold, color: navy, right: true });
  y -= 28;
  row('Approved time', hours(stub.approved_seconds), money(stub.time_pay_minor));
  if (stub.overtime_seconds) row('  of which overtime', hours(stub.overtime_seconds), '');
  if (stub.time_off_hours) row('Paid time off', `${stub.time_off_hours.toFixed(2)} h`, money(stub.time_off_pay_minor));
  row('Gross pay', '', money(stub.gross_minor), true);
  if (stub.adjustments.length) {
    y -= 6;
    draw('Adjustments', M, y, { size: 9, f: bold });
    y -= 18;
    for (const a of stub.adjustments) row(a.label.length > 60 ? `${a.label.slice(0, 59)}…` : a.label, '', `${a.amount_minor < 0 ? '-' : ''}${money(Math.abs(a.amount_minor))}`);
  }
  y -= 4;
  y -= 6;
  page.drawRectangle({ x: M - 8, y: y - 10, width: size[0] - 2 * M + 16, height: 30, color: navy });
  draw('Net pay', M, y, { size: 12, f: bold, color: PDF.white });
  draw(money(stub.net_minor), size[0] - M, y, { size: 13, f: bold, color: PDF.white, right: true });
  y -= 30;
  if (stub.unapproved_seconds) {
    y -= 10;
    draw(`${hours(stub.unapproved_seconds)} in this period was not approved at the time of this payroll and is not included.`, M, y, { size: 8.5, color: muted });
  }
  footer(doc, font, org, M);
  return Buffer.from(await doc.save());
}
