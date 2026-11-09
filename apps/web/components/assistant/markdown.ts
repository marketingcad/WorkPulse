/**
 * A deliberately small Markdown subset for assistant replies: paragraphs, ### headings, - and 1.
 * lists, **bold**, `code` and pipe tables. There is no HTML, no images and no links: model text
 * is shown as text, and the only clickable links in a reply are the server-built navigation chips.
 */
export type Inline = { t: 'text'; v: string } | { t: 'bold'; v: string } | { t: 'code'; v: string };
export type Block =
  | { t: 'p'; inl: Inline[] }
  | { t: 'h'; inl: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; items: Inline[][] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] };

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
    out.push(m[1] !== undefined ? { t: 'bold', v: m[1] } : { t: 'code', v: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => parseInline(c.trim()));
const isTableRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ t: 'p', inl: parseInline(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ t: 'h', inl: parseInline(heading[1]!) });
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableRule(lines[i + 1]!)) {
      flush();
      const head = cells(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(cells(lines[i++]!));
      i--;
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flush();
      const kind = ul ? 'ul' : 'ol';
      const items: Inline[][] = [];
      for (; i < lines.length; i++) {
        const m = kind === 'ul' ? /^\s*[-*]\s+(.*)$/.exec(lines[i]!) : /^\s*\d+[.)]\s+(.*)$/.exec(lines[i]!);
        if (!m) break;
        items.push(parseInline(m[1]!));
      }
      i--;
      blocks.push({ t: kind, items });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}
