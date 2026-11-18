import ExcelJS from 'exceljs';
import type { Column, ReportResult } from '../services/reports';
import { A4, INK, PdfDoc, TYPE, drawTable, fmtDate, fmtDateTime, fmtRange, money, type CompanyProfile, type TableColumn, type TableRow } from './pdf-kit';

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function formatCell(v: string | number | null | undefined, c: Column, currency = 'USD'): string {
  if (v === null || v === undefined || v === '') return '';
  switch (c.type) {
    case 'duration':
      return fmtDuration(Number(v));
    case 'money':
      return (Number(v) / 100).toFixed(2) + (currency ? ` ${currency}` : '');
    case 'percent':
      return `${v}%`;
    case 'datetime':
      return String(v).replace('T', ' ').slice(0, 16);
    default:
      return String(v);
  }
}

/** The currency a row's money is in: its own, else the report's. */
function rowCurrency(r: ReportResult, row: Record<string, string | number | null>): string | undefined {
  return typeof row.currency === 'string' && row.currency ? row.currency : r.currency;
}

/** The totals lines: one, or one per currency (F5: amounts in different currencies are never added). */
export function totalLines(r: ReportResult): Array<{ label: string; values: Record<string, number>; currency?: string }> {
  if (r.totalsByCurrency?.length) return r.totalsByCurrency.map((t) => ({ label: r.totalsByCurrency!.length > 1 ? `Total (${t.currency})` : 'Total', values: t.totals, currency: t.currency }));
  return r.totals ? [{ label: 'Total', values: r.totals, currency: r.currency }] : [];
}

function csvEscape(s: string): string {
  // Guard against CSV/formula injection in spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(r: ReportResult): string {
  const header = r.columns.map((c) => csvEscape(c.label)).join(',');
  const lines = r.rows.map((row) => r.columns.map((c) => csvEscape(formatCell(row[c.key], c, rowCurrency(r, row)))).join(','));
  for (const t of totalLines(r)) lines.push(r.columns.map((c, i) => csvEscape(i === 0 ? t.label : t.values[c.key] !== undefined ? formatCell(t.values[c.key], c, t.currency) : '')).join(','));
  return `﻿${[header, ...lines].join('\r\n')}\r\n`;
}

/**
 * The same CSV as a stream, encoded a chunk of rows at a time, so large exports never build the
 * whole file in memory.
 */
export function csvStream(r: ReportResult, chunkRows = 2000): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  let stage: 'header' | 'rows' | 'done' = 'header';
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (stage === 'header') {
        controller.enqueue(enc.encode(`\uFEFF${r.columns.map((c) => csvEscape(c.label)).join(',')}\r\n`));
        stage = 'rows';
        return;
      }
      if (stage === 'rows' && i < r.rows.length) {
        const end = Math.min(i + chunkRows, r.rows.length);
        let out = '';
        for (; i < end; i++) out += `${r.columns.map((c) => csvEscape(formatCell(r.rows[i]![c.key], c, rowCurrency(r, r.rows[i]!)))).join(',')}\r\n`;
        controller.enqueue(enc.encode(out));
        return;
      }
      for (const t of totalLines(r)) controller.enqueue(enc.encode(`${r.columns.map((c, k) => csvEscape(k === 0 ? t.label : t.values[c.key] !== undefined ? formatCell(t.values[c.key], c, t.currency) : '')).join(',')}\r\n`));
      stage = 'done';
      controller.close();
    },
  });
}

export async function toXlsx(r: ReportResult & { title: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tallywork';
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.columns = r.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 2) }));
  for (const row of r.rows) {
    ws.addRow(
      Object.fromEntries(
        r.columns.map((c) => {
          const v = row[c.key];
          // Durations as Excel time fractions so they can be summed; money as decimals.
          if (c.type === 'duration' && typeof v === 'number') return [c.key, v / 86400];
          if (c.type === 'money' && typeof v === 'number') return [c.key, v / 100];
          return [c.key, v ?? null];
        }),
      ),
    );
  }
  for (const t of totalLines(r)) {
    const row = ws.addRow(
      Object.fromEntries(
        r.columns.map((c, i) => {
          const v = t.values[c.key];
          if (i === 0) return [c.key, t.label];
          if (c.type === 'duration' && v !== undefined) return [c.key, v / 86400];
          if (c.type === 'money' && v !== undefined) return [c.key, v / 100];
          return [c.key, v ?? null];
        }),
      ),
    );
    row.font = { bold: true };
  }
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === 'duration') col.numFmt = '[h]:mm';
    if (c.type === 'money') col.numFmt = '#,##0.00';
  });
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─── PDF ─────────────────────────────────────────────────────────────────────
const NUMERIC: ReadonlySet<Column['type']> = new Set(['money', 'duration', 'number', 'percent']);

/** A cell as the PDF prints it: money with separators and symbol, dates spelled out, times in the org's zone. */
export function formatPdfCell(v: string | number | null | undefined, c: Column, currency: string | undefined, timeZone: string): string {
  if (v === null || v === undefined || v === '') return '';
  switch (c.type) {
    case 'money':
      return currency ? money(Number(v), currency) : (Number(v) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'duration':
      return fmtDuration(Number(v));
    case 'number':
      return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v);
    case 'percent':
      return `${v}%`;
    case 'date':
      return fmtDate(String(v));
    case 'datetime': {
      const s = String(v);
      // An instant (with Z or an offset) is shown in the organization's time zone; a local value as given.
      return /[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? fmtDateTime(s, timeZone) : s.replace('T', ' ').slice(0, 16);
    }
    case 'status': {
      const s = String(v).replace(/_/g, ' ').toLowerCase();
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    default:
      return String(v);
  }
}

export interface ReportPdfOptions {
  company: CompanyProfile;
  from: string;
  to: string;
  generatedAt: Date;
  /** the organization's time zone, for "generated at" and timestamps */
  timezone: string;
}

/**
 * How the columns fit across A4 landscape: the font size, and the column groups to print. Columns are
 * measured from their content. If they do not fit, the font shrinks a little, then text columns wrap,
 * and only then is the table split into groups of columns that repeat the first (identity) column.
 */
export function planColumns(measure: (s: string, size: number, bold: boolean) => number, cols: Column[], cells: string[][], available: number) {
  let pad = 14;
  const natural = (size: number) =>
    cols.map((c, i) => Math.max(measure(c.label.toUpperCase(), Math.max(6, size - 1.5), true), ...cells.map((row) => measure(row[i] ?? '', size, false))) + pad);
  let size = 8;
  let nat = natural(size);
  while (nat.reduce((a, b) => a + b, 0) > available && size > 6.5) {
    size -= 0.5;
    nat = natural(size);
  }
  // Dense tables (e.g. a column per day) get tighter cell padding before anything is split.
  if (nat.reduce((a, b) => a + b, 0) > available) {
    pad = 9;
    nat = natural(size);
  }
  // Text columns may wrap down to their label (or 90 pt, whichever is wider).
  const min = cols.map((c, i) => (NUMERIC.has(c.type) ? nat[i]! : Math.min(nat[i]!, Math.max(90, measure(c.label.toUpperCase(), Math.max(6, size - 1.5), true) + pad))));
  const fits = (idx: number[]) => idx.reduce((s, i) => s + min[i]!, 0) <= available;
  const all = cols.map((_, i) => i);
  let groups: number[][];
  if (fits(all)) groups = [all];
  else {
    // Split, repeating the first column in every group.
    groups = [];
    let cur = [0];
    for (let i = 1; i < cols.length; i++) {
      if (fits([...cur, i]) || cur.length === 1) cur.push(i);
      else {
        groups.push(cur);
        cur = [0, i];
      }
    }
    groups.push(cur);
    // Spread the columns evenly over the same number of pages (16 + 16, not 28 + 3) when that fits.
    const rest = all.slice(1);
    const per = Math.ceil(rest.length / groups.length);
    const even = Array.from({ length: groups.length }, (_, g) => [0, ...rest.slice(g * per, (g + 1) * per)]).filter((g) => g.length > 1);
    if (even.every(fits)) groups = even;
  }
  return { size, pad, natural: nat, min, groups };
}

/** A report as a PDF (A4 landscape): header, summary tiles, then the table with totals. */
export async function toPdf(r: ReportResult & { title: string }, o: ReportPdfOptions): Promise<Buffer> {
  const k = await PdfDoc.create({ title: r.title, size: A4.landscape, margin: { left: 40, right: 40, top: 40, bottom: 70 } });
  const currencies = new Set([r.currency, ...r.rows.map((row) => (typeof row.currency === 'string' ? row.currency : undefined))].filter(Boolean) as string[]);
  await k.drawHeader(o.company, {
    title: r.title,
    meta: [
      ['Period', fmtRange(o.from, o.to)],
      ['Generated', fmtDateTime(o.generatedAt, o.timezone)],
      ['Records', r.rows.length.toLocaleString('en-US')],
      ...(currencies.size ? ([['Currency', [...currencies].join(', ')]] as Array<[string, string]>) : []),
    ],
  });
  const hasDuration = r.columns.some((c) => c.type === 'duration');
  const hasTime = r.columns.some((c) => c.type === 'datetime');
  k.footnote = [`${r.title} · ${fmtRange(o.from, o.to)}`, `Generated ${fmtDateTime(o.generatedAt, o.timezone)}`, hasTime ? `Times in ${o.timezone}` : null, hasDuration ? 'Durations in hours:minutes' : null].filter(Boolean).join('  ·  ');

  // Summary figures.
  if (r.summary.length) {
    k.tiles(
      r.summary.map((s) => ({ label: s.label, value: typeof s.value === 'number' ? formatPdfCell(s.value, { key: '', label: '', type: s.type }, s.currency ?? r.currency, o.timezone) : String(s.value) })),
      { perRow: Math.min(5, r.summary.length) },
    );
    k.y -= 4;
  }

  const body = r.rows.map((row) => r.columns.map((c) => formatPdfCell(row[c.key], c, rowCurrency(r, row), o.timezone)));
  const totals = totalLines(r).map((t) => r.columns.map((c, i) => (i === 0 ? t.label : t.values[c.key] !== undefined ? formatPdfCell(t.values[c.key], c, t.currency, o.timezone) : '')));
  const plan = planColumns((s, size, b) => k.measure(s, size, b), r.columns, [...body, ...totals], k.width);

  plan.groups.forEach((g, gi) => {
    if (plan.groups.length > 1) {
      if (gi > 0) k.newPage();
      const first = g[1] ?? g[0]!;
      const last = g[g.length - 1]!;
      k.text(`Columns ${first + 1}–${last + 1} of ${r.columns.length}`, k.left, k.y, { size: TYPE.small, bold: true, color: INK.slate });
      k.y -= 12;
    }
    const cols: TableColumn[] = g.map((i) => {
      const c = r.columns[i]!;
      const numeric = NUMERIC.has(c.type);
      return numeric ? { key: String(i), label: c.label, align: 'right', width: plan.natural[i] } : { key: String(i), label: c.label, flex: Math.max(1, plan.natural[i]!), wrap: true };
    });
    // Text columns share what is left, but never below what they need to wrap legibly.
    const fixed = cols.reduce((s, c) => s + (c.width ?? 0), 0);
    const textIdx = g.filter((i) => !NUMERIC.has(r.columns[i]!.type));
    const textNeed = textIdx.reduce((s, i) => s + plan.min[i]!, 0);
    if (fixed + textNeed > k.width) {
      // Numeric columns are too wide together: scale everything to fit (keeps all values visible).
      const scale = k.width / (fixed + textNeed);
      for (const c of cols) if (c.width) c.width *= scale;
    }
    const rows: TableRow[] = [
      ...body.map((cells) => ({ cells: Object.fromEntries(g.map((i) => [String(i), cells[i]!])) })),
      ...totals.map((cells) => ({ cells: Object.fromEntries(g.map((i) => [String(i), cells[i]!])), kind: 'total' as const })),
    ];
    drawTable(k, cols, rows, { size: plan.size, padX: plan.pad / 2, empty: 'No records for this period.' });
  });
  return k.finish();
}
