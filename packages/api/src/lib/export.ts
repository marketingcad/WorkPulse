import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Column, ReportResult } from '../services/reports';

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

function csvEscape(s: string): string {
  // Guard against CSV/formula injection in spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(r: ReportResult): string {
  const header = r.columns.map((c) => csvEscape(c.label)).join(',');
  const lines = r.rows.map((row) => r.columns.map((c) => csvEscape(formatCell(row[c.key], c, r.currency))).join(','));
  if (r.totals) lines.push(r.columns.map((c, i) => csvEscape(i === 0 ? 'Total' : r.totals![c.key] !== undefined ? formatCell(r.totals![c.key], c, r.currency) : '')).join(','));
  return `﻿${[header, ...lines].join('\r\n')}\r\n`;
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
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === 'duration') col.numFmt = '[h]:mm';
    if (c.type === 'money') col.numFmt = '#,##0.00';
  });
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function toPdf(r: ReportResult & { title: string }, subtitle: string): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [842, 595]; // A4 landscape
  const margin = 36;
  const usable = pageSize[0] - margin * 2;
  const colW = usable / Math.max(1, r.columns.length);
  let page = doc.addPage(pageSize);
  let y = pageSize[1] - margin;
  const text = (s: string, x: number, yy: number, size = 8, f = font) => {
    const max = Math.floor(colW / (size * 0.5));
    page.drawText(s.length > max ? `${s.slice(0, max - 1)}…` : s, { x, y: yy, size, font: f, color: rgb(0.08, 0.1, 0.14) });
  };
  const header = () => {
    r.columns.forEach((c, i) => text(c.label, margin + i * colW, y, 8, bold));
    y -= 4;
    page.drawLine({ start: { x: margin, y }, end: { x: pageSize[0] - margin, y }, thickness: 0.5, color: rgb(0.8, 0.82, 0.86) });
    y -= 12;
  };
  page.drawText(r.title, { x: margin, y, size: 16, font: bold });
  y -= 18;
  page.drawText(subtitle, { x: margin, y, size: 9, font, color: rgb(0.35, 0.39, 0.45) });
  y -= 24;
  header();
  const rows = [...r.rows];
  if (r.totals) rows.push(Object.fromEntries(r.columns.map((c, i) => [c.key, i === 0 ? 'Total' : (r.totals![c.key] ?? null)])));
  for (const row of rows) {
    if (y < margin + 12) {
      page = doc.addPage(pageSize);
      y = pageSize[1] - margin;
      header();
    }
    r.columns.forEach((c, i) => text(formatCell(row[c.key], c, r.currency), margin + i * colW, y));
    y -= 12;
  }
  return Buffer.from(await doc.save());
}
