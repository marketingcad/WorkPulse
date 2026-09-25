/** Display formatting shared by web and desktop. Follows the active locale (i18n.ts). */
import { getLocale, t } from './i18n';

export type DurationFormat = 'hm' | 'clock' | 'decimal';

export function fmtDuration(seconds: number | null | undefined, format: DurationFormat = 'hm'): string {
  if (seconds === null || seconds === undefined) return '—';
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (format === 'decimal') return new Intl.NumberFormat(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(s / 3600);
  if (format === 'clock') return `${h}:${String(m).padStart(2, '0')}`;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtMoney(minor: number | null | undefined, currency = 'USD'): string {
  if (minor === null || minor === undefined) return '—';
  return new Intl.NumberFormat(getLocale(), { style: 'currency', currency, maximumFractionDigits: 2 }).format(minor / 100);
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat(getLocale(), { ...opts, ...(iso.length === 10 ? { timeZone: 'UTC' } : {}) }).format(d);
}

export function fmtTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(getLocale(), { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));
}

export function fmtDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return t('time.never');
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return t('time.justNow');
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto', style: 'narrow' });
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (diff < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day');
  return fmtDate(iso);
}

export function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v)}%`;
}
