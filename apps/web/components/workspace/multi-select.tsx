'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Popover, cx } from '@tallywork/ui';

export interface MultiOption {
  value: string;
  label: string;
  sub?: string;
}

/** Checkbox list inside a popover. Used for members, teams and assignees. */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  disabled,
  id,
  emptyText = 'Nothing to choose from',
  className,
  ariaLabel,
}: {
  options: MultiOption[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  emptyText?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [q, setQ] = useState('');
  const selected = useMemo(() => new Set(value), [value]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? options.filter((o) => o.label.toLowerCase().includes(n) || o.sub?.toLowerCase().includes(n)) : options;
  }, [options, q]);
  const names = options.filter((o) => selected.has(o.value)).map((o) => o.label);
  const summary = names.length === 0 ? placeholder : names.length <= 2 ? names.join(', ') : `${names.length} selected`;
  const toggle = (v: string) => onChange(selected.has(v) ? value.filter((x) => x !== v) : [...value, v]);

  const trigger = (
    <button
      type="button"
      id={id}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cx(
        'flex h-8 w-full items-center justify-between gap-2 rounded-sm border border-border bg-surface px-2.5 text-left text-sm transition-colors hover:border-border-strong focus:border-interactive focus:outline-none focus:ring-2 focus:ring-interactive/20 disabled:bg-surface-muted disabled:text-text-muted',
        className,
      )}
    >
      <span className={cx('truncate', names.length === 0 && 'text-text-faint')}>{summary}</span>
      <ChevronDown className="size-3.5 shrink-0 text-text-faint" aria-hidden />
    </button>
  );
  if (disabled) return trigger;

  return (
    <Popover trigger={trigger} className="w-72 p-0">
      {options.length > 7 && (
        <label className="relative flex items-center border-b border-border">
          <Search className="pointer-events-none absolute left-2.5 size-3.5 text-text-faint" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search options" className="h-9 w-full bg-transparent pl-8 pr-2 text-sm focus:outline-none" />
        </label>
      )}
      <ul className="max-h-64 overflow-y-auto p-1" role="listbox" aria-multiselectable="true">
        {shown.length === 0 ? (
          <li className="px-2 py-3 text-center text-sm text-text-muted">{options.length ? 'No matches' : emptyText}</li>
        ) : (
          shown.map((o) => (
            <li key={o.value} role="option" aria-selected={selected.has(o.value)}>
              <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-surface-muted">
                <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} className="size-4 accent-[var(--color-interactive)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.sub && <span className="block truncate text-xs text-text-muted">{o.sub}</span>}
                </span>
              </label>
            </li>
          ))
        )}
      </ul>
      {value.length > 0 && (
        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-xs text-text-muted">
          <span className="tabular">{value.length} selected</span>
          <button type="button" className="font-medium text-interactive hover:underline" onClick={() => onChange([])}>
            Clear
          </button>
        </div>
      )}
    </Popover>
  );
}
