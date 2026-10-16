import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { OrgInfo } from '../context';

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

/** The issuing company as printed on documents. */
export interface CompanyProfile extends Pick<OrgInfo, 'name'> {
  logo?: string | null;
  brief?: string | null;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * WorkPulse document colours (the app's design system). Documents carry the organization's name and
 * logo, never WorkPulse branding: only the accent, table and totals styling come from the app.
 */
export const PDF = {
  ink: rgb(0.06, 0.09, 0.16),
  muted: rgb(0.33, 0.38, 0.45),
  navy: rgb(0.024, 0.051, 0.133),
  blue: rgb(0.082, 0.373, 0.961),
  tint: rgb(0.925, 0.949, 1),
  rule: rgb(0.886, 0.906, 0.937),
  white: rgb(1, 1, 1),
};

/** Status pill colours: background and text. */
export const PDF_STATUS: Record<string, { bg: ReturnType<typeof rgb>; fg: ReturnType<typeof rgb>; label: string }> = {
  PAID: { bg: rgb(0.886, 0.961, 0.922), fg: rgb(0.075, 0.467, 0.298), label: 'PAID' },
  PARTIALLY_PAID: { bg: rgb(1, 0.949, 0.859), fg: rgb(0.592, 0.345, 0), label: 'PARTIALLY PAID' },
  OVERDUE: { bg: rgb(0.992, 0.918, 0.91), fg: rgb(0.769, 0.176, 0.141), label: 'OVERDUE' },
  SENT: { bg: rgb(0.925, 0.949, 1), fg: rgb(0.082, 0.373, 0.961), label: 'SENT' },
  DRAFT: { bg: rgb(0.945, 0.957, 0.976), fg: rgb(0.33, 0.38, 0.45), label: 'DRAFT' },
  VOID: { bg: rgb(0.945, 0.957, 0.976), fg: rgb(0.33, 0.38, 0.45), label: 'VOID' },
  FINALIZED: { bg: rgb(0.925, 0.949, 1), fg: rgb(0.082, 0.373, 0.961), label: 'FINALIZED' },
};

/** Deterministic, dependency-light invoice PDF (A4 portrait). */
export async function renderInvoicePdf(inv: InvoiceView, org: CompanyProfile): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${inv.number}`);
  doc.setProducer('Tallywork');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const { ink, muted, navy } = PDF;
  const money = (m: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: inv.currency }).format(m / 100);
  const size: [number, number] = [595, 842];
  let page = doc.addPage(size);
  const M = 48;
  let y = size[1] - M;
  const draw = (raw: string, x: number, yy: number, o: { size?: number; f?: typeof font; color?: typeof ink; right?: boolean } = {}) => {
    const sz = o.size ?? 10;
    const f = o.f ?? font;
    const s = winAnsi(raw);
    const w = f.widthOfTextAtSize(s, sz);
    page.drawText(s, { x: o.right ? x - w : x, y: yy, size: sz, font: f, color: o.color ?? ink });
  };

  page.drawRectangle({ x: 0, y: size[1] - 6, width: size[0], height: 6, color: PDF.blue });
  const logoSize = 44;
  const logo = await embedLogo(doc, org.logo);
  const textX = logo ? M + logoSize + 12 : M;
  if (logo) page.drawImage(logo, { x: M, y: y - logoSize + 14, width: logoSize, height: logoSize });
  draw(org.name, textX, y, { size: 16, f: bold, color: navy });
  draw('INVOICE', size[0] - M, y, { size: 20, f: bold, color: navy, right: true });
  y -= 22;
  draw(inv.number, size[0] - M, y, { size: 11, right: true, color: muted });
  const pill = PDF_STATUS[inv.status];
  if (pill) {
    const label = pill.label;
    const pw = bold.widthOfTextAtSize(label, 7.5) + 14;
    const px = size[0] - M - font.widthOfTextAtSize(winAnsi(inv.number), 11) - 8 - pw;
    page.drawRectangle({ x: px, y: y - 3.5, width: pw, height: 14, color: pill.bg, borderColor: pill.bg, borderWidth: 0 });
    draw(label, px + 7, y, { size: 7.5, f: bold, color: pill.fg });
  }
  const company = [org.brief, ...(org.address ?? '').split('\n'), [org.phone, org.email].filter(Boolean).join('  ·  '), org.taxId ? `Tax ID: ${org.taxId}` : null]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s)
    .slice(0, 6);
  let cy = y + 4;
  for (const line of company) {
    draw(line.length > 70 ? `${line.slice(0, 69)}…` : line, textX, cy, { size: 8.5, color: muted });
    cy -= 11;
  }
  y = Math.min(y, cy, logo ? y - logoSize + 14 - 4 : y) - 22;
  draw('Bill to', M, y, { size: 9, color: muted });
  draw('Issued', 360, y, { size: 9, color: muted });
  draw(inv.issue_date, size[0] - M, y, { right: true });
  y -= 14;
  draw(inv.client.name, M, y, { f: bold });
  draw('Due', 360, y, { size: 9, color: muted });
  draw(inv.due_date, size[0] - M, y, { right: true });
  y -= 14;
  if (inv.client.contact_name) {
    draw(`Attn: ${inv.client.contact_name}`, M, y, { color: muted });
    y -= 14;
  }
  if (inv.client.email) draw(inv.client.email, M, y, { color: muted });
  if (inv.period_start) {
    draw('Period', 360, y, { size: 9, color: muted });
    draw(`${inv.period_start} – ${inv.period_end}`, size[0] - M, y, { right: true });
  }
  y -= 14;
  for (const line of (inv.client.address ?? '').split('\n').filter(Boolean).slice(0, 4)) {
    draw(line, M, y, { color: muted });
    y -= 12;
  }
  y -= 20;

  const cols = { desc: M, qty: 360, price: 440, amount: size[0] - M };
  const header = () => {
    page.drawRectangle({ x: M - 8, y: y - 8, width: size[0] - 2 * M + 16, height: 24, color: PDF.tint });
    draw('DESCRIPTION', cols.desc, y, { size: 8, f: bold, color: navy });
    draw('QTY', cols.qty, y, { size: 8, f: bold, color: navy, right: true });
    draw('RATE', cols.price, y, { size: 8, f: bold, color: navy, right: true });
    draw('AMOUNT', cols.amount, y, { size: 8, f: bold, color: navy, right: true });
    y -= 26;
  };
  header();
  for (const l of inv.lines) {
    if (y < M + 120) {
      page = doc.addPage(size);
      y = size[1] - M;
      header();
    }
    const desc = l.description.length > 60 ? `${l.description.slice(0, 59)}…` : l.description;
    draw(desc, cols.desc, y, { size: 9 });
    draw(l.quantity.toFixed(2), cols.qty, y, { size: 9, right: true });
    draw(money(l.unit_price_minor), cols.price, y, { size: 9, right: true });
    draw(money(l.amount_minor), cols.amount, y, { size: 9, right: true });
    page.drawLine({ start: { x: M - 8, y: y - 7 }, end: { x: size[0] - M + 8, y: y - 7 }, thickness: 0.5, color: PDF.rule });
    y -= 20;
  }
  y -= 10;
  page.drawLine({ start: { x: 330, y: y + 16 }, end: { x: size[0] - M, y: y + 16 }, thickness: 0.5, color: PDF.rule });
  const totalRow = (label: string, value: string, strong = false) => {
    draw(label, cols.price, y, { size: 10, right: true, f: strong ? bold : font });
    draw(value, cols.amount, y, { size: 10, right: true, f: strong ? bold : font });
    y -= 16;
  };
  totalRow('Subtotal', money(inv.subtotal_minor));
  if (inv.tax_minor) totalRow('Tax', money(inv.tax_minor));
  totalRow('Total', money(inv.total_minor), true);
  if (inv.paid_minor) totalRow('Paid', `-${money(inv.paid_minor)}`);
  y -= 6;
  page.drawRectangle({ x: 318, y: y - 9, width: size[0] - M + 8 - 318, height: 28, color: navy });
  draw('Balance due', cols.price, y, { size: 11, f: bold, right: true, color: PDF.white });
  draw(money(inv.balance_minor), cols.amount, y, { size: 12, f: bold, right: true, color: PDF.white });
  y -= 26;
  if (inv.notes) {
    y -= 16;
    draw('Notes', M, y, { size: 9, color: muted });
    y -= 14;
    for (const line of inv.notes.split('\n').slice(0, 10)) {
      draw(line.slice(0, 100), M, y, { size: 9 });
      y -= 12;
    }
  }
  if (inv.status === 'VOID') draw('VOID', size[0] / 2, size[1] / 2, { size: 80, f: bold, color: rgb(0.9, 0.3, 0.3) });
  footer(doc, font, org, M);
  return Buffer.from(await doc.save());
}

/**
 * The standard PDF fonts only encode WinAnsi (Latin-1 plus a few typographic marks). Anything
 * else (a minus sign, Polish ł, CJK in a client name) would make pdf-lib throw, so it is replaced.
 */
export function winAnsi(s: string): string {
  return s.replace(/−/g, '-').replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, '?');
}

/** PNG/JPEG data URLs only; anything unreadable is skipped rather than failing the invoice. */
async function embedLogo(doc: PDFDocument, dataUrl: string | null | undefined) {
  const m = dataUrl?.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!m) return null;
  try {
    const bytes = Buffer.from(m[2]!, 'base64');
    return m[1] === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

/** A thin rule and the organization's contact line at the foot of every page. */
export function footer(doc: PDFDocument, font: PDFFont, org: CompanyProfile, M: number) {
  const contact = [org.name, org.email, org.phone].filter(Boolean).join('  ·  ');
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const { width } = p.getSize();
    p.drawLine({ start: { x: M, y: 40 }, end: { x: width - M, y: 40 }, thickness: 0.5, color: PDF.rule });
    p.drawText(winAnsi(contact), { x: M, y: 26, size: 8, font, color: PDF.muted });
    const n = `${i + 1} / ${pages.length}`;
    p.drawText(n, { x: width - M - font.widthOfTextAtSize(n, 8), y: 26, size: 8, font, color: PDF.muted });
  });
}
