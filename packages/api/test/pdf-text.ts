import { PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, type PDFFont } from 'pdf-lib';

/** Reads every text run back out of a PDF made by pdf-kit: what it says, where, in which font. */

export interface TextRun {
  page: number;
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  /** width in points, measured with the run's font */
  width: number;
}
export interface PdfText {
  pages: number;
  size: Array<{ width: number; height: number }>;
  runs: TextRun[];
  /** all text of a page in drawing order, one run per line */
  page(n: number): string;
  /** all text, every page */
  all: string;
}

// WinAnsi bytes 0x80–0x9F that differ from Latin-1.
const CP1252: Record<number, string> = { 0x80: '€', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x99: '™', 0x8c: 'Œ', 0x9c: 'œ', 0x8a: 'Š', 0x9a: 'š', 0x8e: 'Ž', 0x9e: 'ž', 0x9f: 'Ÿ' };
const decodeHex = (h: string) =>
  Array.from({ length: h.length / 2 }, (_, i) => {
    const b = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return CP1252[b] ?? String.fromCharCode(b);
  }).join('');

let metrics: { regular: PDFFont; bold: PDFFont } | null = null;
async function fonts() {
  if (!metrics) {
    const d = await PDFDocument.create();
    metrics = { regular: await d.embedFont(StandardFonts.Helvetica), bold: await d.embedFont(StandardFonts.HelveticaBold) };
  }
  return metrics;
}

export async function readPdf(bytes: Buffer | Uint8Array): Promise<PdfText> {
  const doc = await PDFDocument.load(bytes);
  const m = await fonts();
  const runs: TextRun[] = [];
  const pages = doc.getPages();
  pages.forEach((p, pi) => {
    // Which resource names are the bold font.
    const fontDict = p.node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
    const boldNames = new Set<string>();
    for (const [name, ref] of fontDict?.entries() ?? []) {
      const f = doc.context.lookup(ref, PDFDict);
      if (String(f.get(PDFName.of('BaseFont'))).includes('Bold')) boldNames.add(name.asString());
    }
    const contents = p.node.Contents();
    const streams: PDFRawStream[] = contents instanceof PDFRawStream ? [contents] : [];
    if (!streams.length && contents) for (const ref of (contents as unknown as { asArray(): unknown[] }).asArray()) streams.push(doc.context.lookup(ref as never) as PDFRawStream);
    const ops = streams.map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString('latin1')).join('\n');
    let font = '';
    let size = 0;
    let x = 0;
    let y = 0;
    for (const t of ops.matchAll(/(\/\S+) ([\d.]+) Tf|(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm|<([0-9A-Fa-f]*)> Tj/g)) {
      if (t[1]) {
        font = t[1];
        size = Number(t[2]);
      } else if (t[3] !== undefined) {
        x = Number(t[7]);
        y = Number(t[8]);
      } else if (t[9] !== undefined) {
        const text = decodeHex(t[9]);
        const bold = boldNames.has(font);
        runs.push({ page: pi + 1, text, x, y, size, bold, width: (bold ? m.bold : m.regular).widthOfTextAtSize(text, size) });
      }
    }
  });
  const page = (n: number) =>
    runs
      .filter((r) => r.page === n)
      .map((r) => r.text)
      .join('\n');
  return { pages: pages.length, size: pages.map((p) => p.getSize()), runs, page, all: pages.map((_, i) => page(i + 1)).join('\n') };
}

/** The text with wrapped lines joined back together, for "is this whole sentence there" checks. */
export const flat = (s: string) => s.replace(/\s+/g, ' ');
