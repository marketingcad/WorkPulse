import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PayStubDto } from '@tallywork/contracts';
import { winAnsi, type CompanyProfile } from './invoice-pdf';

const hours = (s: number) => `${(s / 3600).toFixed(2)} h`;

/** One-page pay stub (A4 portrait), in the same style as the invoice. */
export async function renderPayStubPdf(stub: PayStubDto, org: CompanyProfile): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Pay stub ${stub.period_start} – ${stub.period_end}`);
  doc.setProducer('Tallywork');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.08, 0.1, 0.14);
  const muted = rgb(0.35, 0.39, 0.45);
  const navy = rgb(0.06, 0.13, 0.25);
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
  draw(stub.status === 'PAID' ? `Paid${stub.paid_at ? ` ${stub.paid_at.slice(0, 10)}` : ''}` : 'Finalized', size[0] - M, y, { right: true });
  y -= 34;

  const row = (label: string, detail: string, amount: string, strong = false) => {
    draw(label, M, y, { f: strong ? bold : font });
    draw(detail, 380, y, { color: muted, right: true });
    draw(amount, size[0] - M, y, { f: strong ? bold : font, right: true });
    y -= 18;
  };
  page.drawRectangle({ x: M - 6, y: y - 6, width: size[0] - 2 * M + 12, height: 20, color: rgb(0.93, 0.95, 0.97) });
  draw('Earnings', M, y, { size: 9, f: bold });
  draw('Hours', 380, y, { size: 9, f: bold, right: true });
  draw('Amount', size[0] - M, y, { size: 9, f: bold, right: true });
  y -= 24;
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
  page.drawLine({ start: { x: 330, y: y + 12 }, end: { x: size[0] - M, y: y + 12 }, thickness: 0.5, color: rgb(0.8, 0.82, 0.86) });
  row('Net pay', '', money(stub.net_minor), true);
  if (stub.unapproved_seconds) {
    y -= 10;
    draw(`${hours(stub.unapproved_seconds)} in this period was not approved at the time of this payroll and is not included.`, M, y, { size: 8.5, color: muted });
  }
  return Buffer.from(await doc.save());
}
