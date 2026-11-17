import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import type { OrgInfo } from '../context';

/**
 * The document system behind every PDF WorkPulse produces (invoices, pay stubs, report exports).
 *
 * One palette, one type scale, one header and footer, and one table that wraps text instead of
 * cutting it, breaks across pages and repeats its header. Documents carry the organization's name
 * and logo, never WorkPulse branding. Only the standard PDF fonts are used (Helvetica), so files stay
 * small and deterministic; text outside their character set is replaced, never allowed to throw.
 */

// ─── Palette ─────────────────────────────────────────────────────────────────
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
export const INK = {
  /** headings, document title, key figures, the balance band */
  navy: hex('#0B2545'),
  /** body text and figures */
  charcoal: hex('#1F2933'),
  /** labels and secondary text */
  slate: hex('#52606D'),
  /** captions, footers, empty values */
  muted: hex('#7B8794'),
  /** table rules and dividers */
  rule: hex('#D5DBE3'),
  /** row separators */
  hairline: hex('#E7EBF0'),
  /** table header fill */
  head: hex('#EDF1F6'),
  /** panels and summary tiles */
  panel: hex('#F4F6F9'),
  /** alternate rows */
  zebra: hex('#FAFBFC'),
  /** a single accent, used sparingly (the top edge, the amount-due label) */
  accent: hex('#2F6FEB'),
  /** money received, paid status */
  positive: hex('#137A4B'),
  /** deductions, overdue, void */
  negative: hex('#B42318'),
  white: rgb(1, 1, 1),
} as const;

/** Status pills: fill and text. */
export const STATUS_PILL: Record<string, { bg: RGB; fg: RGB; label: string }> = {
  PAID: { bg: hex('#E3F4EA'), fg: INK.positive, label: 'PAID' },
  PARTIALLY_PAID: { bg: hex('#FDF1DC'), fg: hex('#8A5300'), label: 'PARTIALLY PAID' },
  OVERDUE: { bg: hex('#FBE7E8'), fg: INK.negative, label: 'OVERDUE' },
  SENT: { bg: hex('#E8EEFC'), fg: hex('#1D4FC4'), label: 'SENT' },
  DRAFT: { bg: INK.panel, fg: INK.slate, label: 'DRAFT' },
  VOID: { bg: hex('#FBE7E8'), fg: INK.negative, label: 'VOID' },
  FINALIZED: { bg: hex('#E8EEFC'), fg: hex('#1D4FC4'), label: 'FINALIZED' },
};

// ─── Type scale (points) ─────────────────────────────────────────────────────
export const TYPE = { title: 20, h1: 13, figure: 17, body: 9, table: 8.5, label: 7, small: 7.5, tiny: 6.5 } as const;

/** A4, in points. */
export const A4 = { portrait: [595.28, 841.89] as [number, number], landscape: [841.89, 595.28] as [number, number] };

// ─── Formatting ──────────────────────────────────────────────────────────────
/**
 * The standard PDF fonts only encode WinAnsi (Latin-1 plus a few typographic marks). Anything else
 * (a minus sign, Polish ł, CJK in a client name) would make pdf-lib throw, so it is replaced.
 */
const WIN_ANSI_EXTRA = 'ŒœŠšŽžŸƒˆ˜–—‘’‚“”„†‡•…‰‹›€™';
const NO_DECOMPOSITION: Record<string, string> = { ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ħ: 'h', Ħ: 'H', ı: 'i', ŀ: 'l', Ŀ: 'L', ŧ: 't', Ŧ: 'T', ß: 'ss', ſ: 's', '−': '-' };
const encodable = (ch: string) => {
  const c = ch.charCodeAt(0);
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.includes(ch);
};
export function winAnsi(s: string): string {
  let out = '';
  for (const ch of s.replace(/[\t ]+/g, ' ')) {
    if (encodable(ch)) out += ch;
    else if (NO_DECOMPOSITION[ch]) out += NO_DECOMPOSITION[ch];
    else {
      // Latin letters with marks the font lacks (ż, ę, ő, ă…): keep the letter, drop the mark.
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += base && [...base].every(encodable) ? base : '?';
    }
  }
  return out;
}

/** Money in the document's currency, e.g. $1,250.00 or -$15.00. */
export function money(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A calendar date (YYYY-MM-DD) as "Nov 18, 2026". Anything else is returned as given. */
export function fmtDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return iso ?? '';
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** A date range as "Nov 16 – Nov 22, 2026" (the year once when both ends share it). */
export function fmtRange(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return fmtDate(from ?? to);
  const a = fmtDate(from);
  const b = fmtDate(to);
  return from.slice(0, 4) === to.slice(0, 4) ? `${a.replace(/, \d{4}$/, '')} – ${b}` : `${a} – ${b}`;
}

/** An instant in a time zone, as "Nov 18, 2026, 5:45 PM". */
export function fmtDateTime(at: Date | string, timeZone: string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return String(at);
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }
}

/** Hours with two decimals, as payroll shows them: 10.50. */
export const hours2 = (seconds: number) => (seconds / 3600).toFixed(2);

// ─── Company profile and logo ────────────────────────────────────────────────
/** The issuing company as printed on documents. */
export interface CompanyProfile extends Pick<OrgInfo, 'name'> {
  /** square logo (avatars); printed when there is no document logo */
  logo?: string | null;
  /** uncropped logo for documents, any shape */
  documentLogo?: string | null;
  brief?: string | null;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

/** The box a document logo is fitted into, in PDF points (keeps its shape; wide logos use the width). */
export const DOC_LOGO_BOX = { width: 160, height: 48 } as const;
/** The square logo's size when there is no document logo. */
export const SQUARE_LOGO_SIZE = 44;

/** Scale `w × h` to fit inside `box` without distorting it. Null for an image with no size. */
export function fitLogo(w: number, h: number, box: { width: number; height: number } = DOC_LOGO_BOX): { width: number; height: number } | null {
  if (!(w > 0 && h > 0)) return null;
  const s = Math.min(box.width / w, box.height / h);
  return { width: w * s, height: h * s };
}

/** PNG/JPEG data URLs only; anything unreadable is skipped rather than failing the document. */
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

/**
 * Draws the organization's logo with its top edge at `top`: the document logo, fitted to DOC_LOGO_BOX,
 * or else the square logo. Returns the size drawn, or null when there is no usable logo. A broken
 * image is skipped and never breaks the document.
 */
export async function drawCompanyLogo(doc: PDFDocument, page: PDFPage, org: CompanyProfile, x: number, top: number): Promise<{ width: number; height: number } | null> {
  const wide = await embedLogo(doc, org.documentLogo);
  const fit = wide && fitLogo(wide.width, wide.height);
  if (wide && fit) {
    page.drawImage(wide, { x, y: top - fit.height, ...fit });
    return fit;
  }
  const square = await embedLogo(doc, org.logo);
  if (!square) return null;
  page.drawImage(square, { x, y: top - SQUARE_LOGO_SIZE, width: SQUARE_LOGO_SIZE, height: SQUARE_LOGO_SIZE });
  return { width: SQUARE_LOGO_SIZE, height: SQUARE_LOGO_SIZE };
}

/** The company's contact details as short lines, for the header. */
export function companyLines(org: CompanyProfile): string[] {
  return [org.brief, ...(org.address ?? '').split('\n'), [org.phone, org.email].filter(Boolean).join('  ·  '), org.taxId ? `Tax ID ${org.taxId}` : null]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s)
    .slice(0, 6);
}

// ─── The document ────────────────────────────────────────────────────────────
export type Align = 'left' | 'right' | 'center';
interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: RGB;
  align?: Align;
  /** shortens the text with an ellipsis to fit; use only where wrapping is not possible */
  maxWidth?: number;
  opacity?: number;
}

export interface DocHeader {
  /** e.g. INVOICE, PAY STUB, or a report's name */
  title: string;
  /** e.g. the invoice number; repeated on every continuation page */
  reference?: string;
  /** label/value pairs, right-hand column */
  meta: Array<[string, string]>;
  /** a status pill at the end of the meta block */
  status?: { key: string; label?: string };
}

/**
 * A multi-page document with a fixed header on page 1, a compact identity line on every later page,
 * and a footer with the company line, an optional note and "Page X of Y" on every page.
 */
export class PdfDoc {
  readonly doc: PDFDocument;
  readonly font: PDFFont;
  readonly bold: PDFFont;
  readonly size: [number, number];
  readonly margin: { top: number; right: number; bottom: number; left: number };
  page!: PDFPage;
  y = 0;
  private header: DocHeader | null = null;
  private company: CompanyProfile = { name: '' };
  /** printed in the footer under the company line, on every page */
  footnote: string | null = null;

  private constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont, size: [number, number], margin: PdfDoc['margin']) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
    this.size = size;
    this.margin = margin;
  }

  static async create(o: { title: string; size?: [number, number]; margin?: Partial<PdfDoc['margin']> }): Promise<PdfDoc> {
    const doc = await PDFDocument.create();
    doc.setTitle(winAnsi(o.title));
    doc.setProducer('Tallywork');
    doc.setCreator('Tallywork');
    const [font, bold] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
    const k = new PdfDoc(doc, font, bold, o.size ?? A4.portrait, { top: 44, right: 48, bottom: 64, left: 48, ...o.margin });
    k.page = doc.addPage(k.size);
    k.y = k.size[1] - k.margin.top;
    k.edge();
    return k;
  }

  get left() {
    return this.margin.left;
  }
  get right() {
    return this.size[0] - this.margin.right;
  }
  get width() {
    return this.right - this.left;
  }
  /** the lowest y content may reach, above the footer */
  get floor() {
    return this.margin.bottom;
  }

  /** Width of `s` in points. */
  measure(s: string, size: number, bold = false): number {
    return (bold ? this.bold : this.font).widthOfTextAtSize(winAnsi(s), size);
  }

  /** Draws one line of text; returns its width. */
  text(raw: string, x: number, y: number, o: TextOpts = {}): number {
    const size = o.size ?? TYPE.body;
    const f = o.bold ? this.bold : this.font;
    let s = winAnsi(raw);
    if (o.maxWidth != null && f.widthOfTextAtSize(s, size) > o.maxWidth) {
      while (s.length > 1 && f.widthOfTextAtSize(`${s}…`, size) > o.maxWidth) s = s.slice(0, -1);
      s = `${s.trimEnd()}…`;
    }
    const w = f.widthOfTextAtSize(s, size);
    const at = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    this.page.drawText(s, { x: at, y, size, font: f, color: o.color ?? INK.charcoal, opacity: o.opacity });
    return w;
  }

  /** Splits text into lines no wider than `width`, keeping words whole where they fit. */
  wrap(raw: string, width: number, size: number, bold = false): string[] {
    const f = bold ? this.bold : this.font;
    // A hair of tolerance so text measured to fit exactly is not wrapped by rounding.
    const fits = (s: string) => f.widthOfTextAtSize(s, size) <= width + 0.5;
    const out: string[] = [];
    for (const para of raw.replace(/\r/g, '').split('\n').map(winAnsi)) {
      const words = para.split(' ');
      let line = '';
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (fits(next)) {
          line = next;
          continue;
        }
        if (line) out.push(line);
        // A single word longer than the line: break it.
        let w = word;
        while (!fits(w) && w.length > 1) {
          let i = w.length - 1;
          while (i > 1 && !fits(w.slice(0, i))) i--;
          out.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  }

  rect(x: number, y: number, w: number, h: number, color: RGB) {
    this.page.drawRectangle({ x, y, width: w, height: h, color });
  }

  line(x1: number, y1: number, x2: number, y2: number, color: RGB = INK.rule, thickness = 0.6) {
    this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
  }

  /** A small rounded-looking status pill, right-aligned at `right`; returns its width. */
  pill(key: string, right: number, baseline: number, label?: string): number {
    const p = STATUS_PILL[key] ?? STATUS_PILL.DRAFT!;
    const text = winAnsi(label ?? p.label);
    const size = TYPE.tiny;
    const w = this.bold.widthOfTextAtSize(text, size) + 12;
    this.rect(right - w, baseline - 3.5, w, 13, p.bg);
    this.text(text, right - 6, baseline, { size, bold: true, color: p.fg, align: 'right' });
    return w;
  }

  /** The thin navy edge at the top of every page. */
  private edge() {
    this.rect(0, this.size[1] - 3, this.size[0], 3, INK.navy);
  }

  /** Starts a new page with the compact identity line; returns the new page. */
  newPage(): PDFPage {
    this.page = this.doc.addPage(this.size);
    this.edge();
    this.y = this.size[1] - this.margin.top + 8;
    if (this.header) {
      const h = this.header;
      this.text(this.company.name, this.left, this.y, { size: TYPE.small + 0.5, bold: true, color: INK.navy, maxWidth: this.width / 2 });
      const ref = [h.title, h.reference].filter(Boolean).join('  ');
      this.text(`${ref}  ·  continued`, this.right, this.y, { size: TYPE.small, color: INK.slate, align: 'right', maxWidth: this.width / 2 });
      this.y -= 9;
      this.line(this.left, this.y, this.right, this.y, INK.rule, 0.6);
      this.y -= 18;
    }
    return this.page;
  }

  /** Moves to a new page unless `height` points fit above the footer. */
  ensure(height: number) {
    if (this.y - height < this.floor) this.newPage();
  }

  /**
   * Page 1's header: logo and company on the left; the document title, reference, details and
   * status on the right. Leaves `y` under a full-width rule.
   */
  async drawHeader(company: CompanyProfile, h: DocHeader) {
    this.header = h;
    this.company = company;
    const top = this.y;
    const colW = Math.min(250, this.width * 0.42);

    // Left: logo, then the company's name and details.
    let ly = top;
    const logo = await drawCompanyLogo(this.doc, this.page, company, this.left, top + 4);
    if (logo) ly = top + 4 - logo.height - 14;
    else ly = top - 12;
    this.text(company.name, this.left, ly, { size: logo ? TYPE.h1 - 1.5 : TYPE.h1 + 2, bold: true, color: INK.navy, maxWidth: this.width - colW - 24 });
    ly -= 13;
    for (const l of companyLines(company)) {
      this.text(l, this.left, ly, { size: TYPE.small, color: INK.slate, maxWidth: this.width - colW - 24 });
      ly -= 10;
    }

    // Right: title, reference, then the details as a small ledger.
    let ry = top - 14;
    // The reference is already in the details below; it is repeated only on continuation pages.
    this.text(h.title.toUpperCase(), this.right, ry, { size: TYPE.title, bold: true, color: INK.navy, align: 'right', maxWidth: colW + 60 });
    ry -= 24;
    const lx = this.right - colW;
    for (const [label, value] of h.meta) {
      this.line(lx, ry + 9.5, this.right, ry + 9.5, INK.hairline, 0.5);
      this.text(label.toUpperCase(), lx, ry, { size: TYPE.label, color: INK.slate, bold: true });
      this.text(value, this.right, ry, { size: TYPE.body, color: INK.charcoal, align: 'right', maxWidth: colW - 80 });
      ry -= 14;
    }
    if (h.status) {
      this.line(lx, ry + 9.5, this.right, ry + 9.5, INK.hairline, 0.5);
      this.text('STATUS', lx, ry, { size: TYPE.label, color: INK.slate, bold: true });
      this.pill(h.status.key, this.right, ry, h.status.label);
      ry -= 14;
    }
    this.y = Math.min(ly, ry) - 8;
    this.line(this.left, this.y, this.right, this.y, INK.navy, 0.9);
    this.y -= 22;
  }

  /** A small caps section label with space above. */
  section(label: string, opts: { gap?: number } = {}) {
    this.ensure(40);
    this.y -= opts.gap ?? 0;
    this.text(label.toUpperCase(), this.left, this.y, { size: TYPE.label, bold: true, color: INK.slate });
    this.y -= 12;
  }

  /** A paragraph that wraps and breaks across pages. */
  paragraph(raw: string, o: { size?: number; color?: RGB; x?: number; width?: number; leading?: number } = {}) {
    const size = o.size ?? TYPE.body;
    const lead = o.leading ?? size * 1.45;
    const x = o.x ?? this.left;
    for (const l of this.wrap(raw, o.width ?? this.right - x, size)) {
      this.ensure(lead);
      this.text(l, x, this.y, { size, color: o.color ?? INK.charcoal });
      this.y -= lead;
    }
  }

  /**
   * Summary tiles in a row: a label and a figure each; `strong` ones are filled navy. Tiles wrap onto
   * a second row when there are more than fit.
   */
  tiles(items: Array<{ label: string; value: string; note?: string; strong?: boolean }>, o: { perRow?: number; x?: number; width?: number } = {}) {
    if (!items.length) return;
    const x0 = o.x ?? this.left;
    const W = o.width ?? this.width;
    const per = Math.max(1, Math.min(o.perRow ?? 4, items.length));
    const gap = 8;
    const w = (W - gap * (per - 1)) / per;
    const h = items.some((i) => i.note) ? 54 : 46;
    for (let r = 0; r < items.length; r += per) {
      this.ensure(h + gap);
      const row = items.slice(r, r + per);
      row.forEach((it, i) => {
        const x = x0 + i * (w + gap);
        const yb = this.y - h;
        this.rect(x, yb, w, h, it.strong ? INK.navy : INK.panel);
        this.text(it.label.toUpperCase(), x + 10, this.y - 14, { size: TYPE.label, bold: true, color: it.strong ? hex('#B9C7DD') : INK.slate, maxWidth: w - 20 });
        this.text(it.value, x + 10, this.y - 33, { size: TYPE.figure - 2, bold: true, color: it.strong ? INK.white : INK.navy, maxWidth: w - 20 });
        if (it.note) this.text(it.note, x + 10, this.y - 46, { size: TYPE.tiny, color: it.strong ? hex('#B9C7DD') : INK.muted, maxWidth: w - 20 });
      });
      this.y -= h + gap;
    }
    this.y -= 8;
  }

  /** A diagonal word across the middle of every page (e.g. VOID). */
  private stamps: string[] = [];
  watermark(word: string) {
    this.stamps.push(word);
  }

  /** Draws the footer on every page and returns the file. */
  async finish(): Promise<Buffer> {
    const pages = this.doc.getPages();
    const contact = [this.company.name, this.company.email, this.company.phone].filter(Boolean).join('  ·  ');
    pages.forEach((p, i) => {
      this.page = p;
      for (const w of this.stamps) {
        const size = 96;
        const tw = this.bold.widthOfTextAtSize(w, size);
        p.drawText(w, { x: this.size[0] / 2 - (tw / 2) * Math.cos(Math.PI / 6), y: this.size[1] / 2 - (tw / 2) * Math.sin(Math.PI / 6), size, font: this.bold, color: INK.negative, opacity: 0.1, rotate: degrees(30) });
      }
      const fy = 40;
      this.line(this.left, fy + 12, this.right, fy + 12, INK.rule, 0.5);
      const num = `Page ${i + 1} of ${pages.length}`;
      const numW = this.font.widthOfTextAtSize(num, TYPE.small);
      this.text(contact, this.left, fy, { size: TYPE.small, color: INK.slate, maxWidth: this.width - numW - 24 });
      this.text(num, this.right, fy, { size: TYPE.small, color: INK.slate, align: 'right' });
      if (this.footnote) this.text(this.footnote, this.left, fy - 11, { size: TYPE.tiny, color: INK.muted, maxWidth: this.width });
    });
    return Buffer.from(await this.doc.save());
  }
}

// ─── Tables ──────────────────────────────────────────────────────────────────
export interface TableColumn {
  key: string;
  label: string;
  align?: Align;
  /** fixed width in points */
  width?: number;
  /** share of the width left after fixed columns (default 1 for columns without a width) */
  flex?: number;
  /** wrap long text onto more lines (default true for left-aligned columns) */
  wrap?: boolean;
}
export type RowKind = 'data' | 'subtotal' | 'total' | 'section';
export interface TableRow {
  cells: Record<string, string>;
  kind?: RowKind;
  /** per-cell text colour, e.g. a deduction in red */
  color?: Record<string, RGB>;
  /** indent the first column (a detail line under another) */
  indent?: boolean;
}
export interface TableOpts {
  size?: number;
  x?: number;
  width?: number;
  zebra?: boolean;
  /** shown under the header when there are no rows */
  empty?: string;
  padX?: number;
}

/** Column widths for a table: fixed widths first, then flex shares of the rest. */
export function resolveWidths(cols: TableColumn[], total: number): number[] {
  const fixed = cols.reduce((s, c) => s + (c.width ?? 0), 0);
  const flexSum = cols.reduce((s, c) => s + (c.width == null ? (c.flex ?? 1) : 0), 0);
  const rest = Math.max(0, total - fixed);
  return cols.map((c) => c.width ?? (flexSum ? (rest * (c.flex ?? 1)) / flexSum : 0));
}

/**
 * Draws a table at the current position. Text wraps inside its column (nothing is cut off), rows
 * never split across pages, and the header row repeats at the top of each new page.
 */
export function drawTable(k: PdfDoc, cols: TableColumn[], rows: TableRow[], o: TableOpts = {}) {
  const size = o.size ?? TYPE.table;
  const headSize = Math.max(6, size - 1.5);
  const x0 = o.x ?? k.left;
  const W = o.width ?? k.width;
  const padX = o.padX ?? 7;
  const lead = size * 1.32;
  const padY = 5.5;
  const widths = resolveWidths(cols, W);
  const xs = widths.reduce<number[]>((a, w, i) => [...a, i ? a[i - 1]! + widths[i - 1]! : x0], []);
  const cellX = (i: number) => (cols[i]!.align === 'right' ? xs[i]! + widths[i]! - padX : cols[i]!.align === 'center' ? xs[i]! + widths[i]! / 2 : xs[i]! + padX);

  const headLines = cols.map((c, i) => k.wrap(c.label.toUpperCase(), widths[i]! - 2 * padX, headSize, true));
  const headH = Math.max(...headLines.map((l) => l.length)) * headSize * 1.25 + 2 * padY + 1;
  const header = () => {
    k.rect(x0, k.y - headH, W, headH, INK.head);
    headLines.forEach((lines, i) =>
      lines.forEach((l, j) => k.text(l, cellX(i), k.y - padY - headSize - j * headSize * 1.25 + 1, { size: headSize, bold: true, color: INK.navy, align: cols[i]!.align })),
    );
    k.line(x0, k.y - headH, x0 + W, k.y - headH, INK.navy, 0.7);
    k.y -= headH;
  };

  const layout = (r: TableRow) => {
    const bold = r.kind === 'subtotal' || r.kind === 'total' || r.kind === 'section';
    const lines = cols.map((c, i) => {
      const v = r.cells[c.key] ?? '';
      const inner = widths[i]! - 2 * padX - (i === 0 && r.indent ? 10 : 0);
      return (c.wrap ?? c.align !== 'right') ? k.wrap(v, inner, size, bold) : [v];
    });
    return { bold, lines, h: Math.max(1, ...lines.map((l) => l.length)) * lead + 2 * padY - (lead - size) };
  };

  k.ensure(headH + (rows[0] ? layout(rows[0]).h : 20));
  header();
  if (!rows.length && o.empty) {
    k.y -= 16;
    k.text(o.empty, x0 + padX, k.y, { size, color: INK.muted });
    k.y -= 10;
    return;
  }
  let n = 0;
  for (const r of rows) {
    const { bold, lines, h } = layout(r);
    if (k.y - h < k.floor) {
      k.newPage();
      header();
    }
    const top = k.y;
    if (r.kind === 'total') k.rect(x0, top - h, W, h, INK.panel);
    else if (r.kind === 'section') k.rect(x0, top - h, W, h, INK.zebra);
    else if (o.zebra !== false && r.kind !== 'subtotal' && n % 2 === 1) k.rect(x0, top - h, W, h, INK.zebra);
    if (r.kind === 'total') k.line(x0, top, x0 + W, top, INK.charcoal, 0.8);
    if (r.kind === 'subtotal') k.line(x0, top, x0 + W, top, INK.rule, 0.7);
    lines.forEach((ls, i) => {
      const color = r.color?.[cols[i]!.key] ?? (r.kind === 'section' ? INK.slate : INK.charcoal);
      ls.forEach((l, j) => k.text(l, cellX(i) + (i === 0 && r.indent ? 10 : 0), top - padY - size - j * lead + 1.5, { size: r.kind === 'section' ? TYPE.label : size, bold, color, align: cols[i]!.align }));
    });
    k.y = top - h;
    if (r.kind !== 'total') k.line(x0, k.y, x0 + W, k.y, INK.hairline, 0.5);
    n = r.kind === 'data' || !r.kind ? n + 1 : 0;
  }
}

/**
 * A right-hand ledger of totals (label and amount per line); the `band` line is drawn as a filled
 * navy bar. Kept together on one page.
 */
export function drawTotals(k: PdfDoc, lines: Array<{ label: string; value: string; strong?: boolean; color?: RGB; band?: boolean; muted?: boolean }>, o: { width?: number } = {}) {
  const W = o.width ?? 250;
  const x = k.right - W;
  const height = lines.reduce((s, l) => s + (l.band ? 34 : 19), 0) + 10;
  k.ensure(height + 14);
  k.y -= 14;
  for (const l of lines) {
    if (l.band) {
      k.y -= 6;
      k.rect(x, k.y - 22, W, 30, l.muted ? INK.slate : INK.navy);
      k.text(l.label.toUpperCase(), x + 12, k.y - 11, { size: TYPE.small, bold: true, color: INK.white });
      k.text(l.value, k.right - 12, k.y - 12, { size: TYPE.h1 + 1, bold: true, color: INK.white, align: 'right' });
      k.y -= 30;
      continue;
    }
    if (l.strong) k.line(x, k.y + 12, k.right, k.y + 12, INK.charcoal, 0.8);
    k.text(l.label, x + 12, k.y, { size: TYPE.body, bold: l.strong, color: l.strong ? INK.charcoal : INK.slate });
    k.text(l.value, k.right - 12, k.y, { size: TYPE.body, bold: l.strong, color: l.color ?? INK.charcoal, align: 'right' });
    k.y -= 19;
  }
  k.y -= 4;
}
