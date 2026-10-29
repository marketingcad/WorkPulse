'use client';
import type { ReactNode } from 'react';
import { StatusBadge, fmtDate, fmtDateTime, fmtMoney, fmtPct } from '@tallywork/ui';

export type ColumnType = 'text' | 'duration' | 'money' | 'percent' | 'date' | 'datetime' | 'number' | 'status';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

/** Mirrors ReportResult in packages/api/src/services/reports.ts */
export interface ReportResult {
  key: string;
  title: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  totals?: Record<string, number>;
  /** Money in several currencies: one totals line per currency, never added together. */
  totalsByCurrency?: Array<{ currency: string; totals: Record<string, number> }>;
  summary: Array<{ label: string; value: number | string; type: ColumnType; currency?: string }>;
  chart?: { type: 'bar' | 'stacked-bar' | 'line'; x: string; series: Array<{ key: string; label: string }>; data: Array<Record<string, string | number>> };
  currency?: string;
}

export interface CatalogItem {
  key: string;
  title: string;
  question: string;
  category: 'Time' | 'Activity' | 'People' | 'Finance' | 'Compliance';
  groupings: string[];
  /** Filters the report applies (older servers omit it: all). */
  filters?: Array<'dates' | 'members' | 'teams' | 'projects' | 'clients' | 'billable'>;
  /** Covered by another report; still opens from saved reports. */
  hidden?: boolean;
}

export interface SavedReport {
  id: string;
  report_key: string;
  name: string;
  params: Record<string, unknown>;
  shared: boolean;
  schedule_cron: string | null;
  schedule_timezone: string | null;
  recipients: string[];
  last_run_at: string | null;
  owner: boolean;
}

/** Mirrors runDto in packages/api/src/services/report-runs.ts */
export interface ReportRun {
  id: string;
  report_key: string;
  format: 'CSV' | 'XLSX' | 'PDF' | 'JSON';
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
  row_count: number | null;
  error: string | null;
  scheduled: boolean;
  created_at: string;
  finished_at: string | null;
  download_url: string | null;
}

export interface FormatCtx {
  fmtDuration: (s: number | null | undefined) => string;
  currency: string;
  timeZone?: string;
}

export const NUMERIC_TYPES: ColumnType[] = ['duration', 'money', 'percent', 'number'];

/** Plain-text formatting (KPI values, chart tooltips, totals). */
export function formatValue(type: ColumnType, v: unknown, f: FormatCtx): string {
  if (v === null || v === undefined || v === '') return '—';
  switch (type) {
    case 'duration':
      return f.fmtDuration(Number(v));
    case 'money':
      return fmtMoney(Number(v), f.currency);
    case 'percent':
      return fmtPct(Number(v));
    case 'date':
      return fmtDate(String(v));
    case 'datetime':
      return fmtDateTime(String(v), f.timeZone);
    case 'number':
      return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v);
    case 'status':
    case 'text':
    default:
      return String(v);
  }
}

/** Table cell rendering: status values become badges. */
export function formatCell(type: ColumnType, v: unknown, f: FormatCtx): ReactNode {
  if (type === 'status') return v ? <StatusBadge status={String(v)} /> : <span className="text-text-faint">—</span>;
  const s = formatValue(type, v, f);
  return s === '—' ? <span className="text-text-faint">—</span> : s;
}
