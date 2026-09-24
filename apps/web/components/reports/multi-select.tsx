'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Button, Popover, cx } from '@tallywork/ui';

export interface Option {
  value: string;
  label: string;
  sub?: string;
}

/** Compact multi-select filter: a button showing the count, a searchable checkbox list in a popover. */
export function MultiSelect({ label, options, value, onChange, allLabel = 'All', loading }: { label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void; allLabel?: string; loading?: boolean }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? options.filter((o) => o.label.toLowerCase().includes(n)) : options;
  }, [options, q]);
  const selected = new Set(value);
  const summary = value.length === 0 ? allLabel : value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? '1 selected') : `${value.length} selected`;
  const toggle = (v: string) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <Popover
      align="start"
      className="w-72 p-0"
      trigger={
        <Button className={cx(value.length > 0 && 'border-interactive text-interactive')} aria-label={`${label}: ${summary}`}>
          <span className="text-text-muted">{label}:</span>
          <span className="max-w-32 truncate">{summary}</span>
          <ChevronDown className="size-3.5 text-text-faint" aria-hidden />
        </Button>
      }
    >
      <div className="border-b border-border p-2">
        <label className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 size-3.5 text-text-faint" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`} aria-label={`Search ${label}`} className="h-7 w-full rounded-sm border border-border bg-surface pl-7 pr-2 text-sm focus:border-interactive focus:outline-none" />
        </label>
      </div>
      <ul className="max-h-64 overflow-y-auto py-1" role="listbox" aria-multiselectable aria-label={label}>
        {loading && <li className="px-3 py-2 text-sm text-text-muted">Loading…</li>}
        {!loading && shown.length === 0 && <li className="px-3 py-2 text-sm text-text-muted">No matches</li>}
        {shown.map((o) => (
          <li key={o.value}>
            <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-surface-muted">
              <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} className="size-3.5 accent-[var(--color-interactive)]" />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.sub && <span className="truncate text-xs text-text-faint">{o.sub}</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex justify-between border-t border-border px-3 py-2 text-xs">
        <button type="button" className="text-text-muted hover:text-text disabled:opacity-40" disabled={!value.length} onClick={() => onChange([])}>
          Clear
        </button>
        <span className="tabular text-text-faint">
          {value.length} of {options.length}
        </span>
      </div>
    </Popover>
  );
}
