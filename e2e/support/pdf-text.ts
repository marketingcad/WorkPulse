import { inflateSync } from 'node:zlib';

/**
 * The text of a PDF made by WorkPulse (pdf-lib, standard fonts): every `<hex> Tj` run in its
 * compressed content streams, decoded from WinAnsi, one run per line. Enough to check that a
 * downloaded document says what it should; not a general PDF parser.
 */
const CP1252: Record<number, string> = { 0x80: '€', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—' };

export function pdfText(bytes: Buffer): string {
  const raw = bytes.toString('latin1');
  const runs: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    let body: string;
    try {
      body = inflateSync(bytes.subarray(start, end)).toString('latin1');
    } catch {
      continue; // an image or an uncompressed stream
    }
    for (const t of body.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) {
      runs.push(Array.from({ length: t[1]!.length / 2 }, (_, i) => {
        const b = parseInt(t[1]!.slice(i * 2, i * 2 + 2), 16);
        return CP1252[b] ?? String.fromCharCode(b);
      }).join(''));
    }
    re.lastIndex = end;
  }
  return runs.join('\n');
}

/** Wrapped lines joined back together. */
export const flatText = (bytes: Buffer) => pdfText(bytes).replace(/\s+/g, ' ');
