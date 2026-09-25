'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Search } from 'lucide-react';
import { cx } from './primitives';
import { EmptyState, SkeletonRows } from './display';
import { t } from './i18n';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** value used for sorting and search */
  value?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right' | 'center';
  width?: string;
  /** hidden below this breakpoint on stacked mobile layout: 'primary' fields always show */
  priority?: 'primary' | 'secondary' | 'low';
  sortable?: boolean;
  className?: string;
}

export interface DataTableProps<T> {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (s: Set<string>) => void;
  bulkActions?: (selected: string[]) => ReactNode;
  footer?: ReactNode;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  searchable?: boolean;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  density?: 'compact' | 'comfortable';
  rowClassName?: (row: T) => string | undefined;
  pageSize?: number;
  caption?: string;
}

/**
 * Accessible, dense data table with sorting, search, selection + bulk bar,
 * client pagination, and a stacked card layout on small screens.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  loading,
  onRowClick,
  empty,
  selectable,
  selected,
  onSelectedChange,
  bulkActions,
  footer,
  initialSort,
  searchable,
  searchPlaceholder = t('table.searchPlaceholder'),
  toolbar,
  density = 'compact',
  rowClassName,
  pageSize = 100,
  caption,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    let r = rows ?? [];
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      r = r.filter((row) => columns.some((c) => String(c.value?.(row) ?? '').toLowerCase().includes(needle)));
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.value) {
        r = [...r].sort((a, b) => {
          const va = col.value!(a);
          const vb = col.value!(b);
          if (va === vb) return 0;
          if (va === null || va === undefined) return 1;
          if (vb === null || vb === undefined) return -1;
          const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
          return sort.dir === 'asc' ? cmp : -cmp;
        });
      }
    }
    return r;
  }, [rows, q, sort, columns]);

  const pageRows = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const sel = selected ?? new Set<string>();
  const allOnPage = pageRows.length > 0 && pageRows.every((r) => sel.has(rowKey(r)));
  const toggleAll = () => {
    const next = new Set(sel);
    if (allOnPage) pageRows.forEach((r) => next.delete(rowKey(r)));
    else pageRows.forEach((r) => next.add(rowKey(r)));
    onSelectedChange?.(next);
  };
  const toggle = (k: string) => {
    const next = new Set(sel);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onSelectedChange?.(next);
  };
  const rowH = density === 'compact' ? 'h-10' : 'h-12';

  return (
    <div className="flex min-w-0 flex-col">
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          {searchable && (
            <label className="relative flex min-w-48 flex-1 items-center sm:max-w-72">
              <Search className="pointer-events-none absolute left-2 size-3.5 text-text-faint" aria-hidden />
              <input
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(0);
                }}
                placeholder={searchPlaceholder}
                aria-label={t('table.searchLabel')}
                className="h-7 w-full rounded-sm border border-border bg-surface pl-7 pr-2 text-sm placeholder:text-text-faint focus:border-interactive focus:outline-none"
              />
            </label>
          )}
          {toolbar}
        </div>
      )}
      {selectable && sel.size > 0 && bulkActions && (
        <div className="flex items-center gap-3 border-b border-border bg-interactive-soft px-3 py-1.5 text-sm">
          <span className="font-medium text-interactive">{t('table.selected', { count: sel.size })}</span>
          <div className="flex items-center gap-1.5">{bulkActions([...sel])}</div>
          <button className="ml-auto text-xs text-text-muted hover:text-text" onClick={() => onSelectedChange?.(new Set())}>
            {t('common.clear')}
          </button>
        </div>
      )}

      {loading && !rows ? (
        <SkeletonRows cols={Math.min(columns.length, 6)} />
      ) : filtered.length === 0 ? (
        (empty ?? <EmptyState title={q ? t('table.noMatches') : t('table.empty')} description={q ? t('table.tryDifferentSearch') : undefined} />)
      ) : (
        <>
          {/* Desktop/tablet table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              {caption && <caption className="sr-only">{caption}</caption>}
              <thead>
                <tr className="border-b border-border bg-surface-muted/60">
                  {selectable && (
                    <th className="w-9 px-3">
                      <input type="checkbox" aria-label={t('table.selectAll')} checked={allOnPage} onChange={toggleAll} className="size-3.5 accent-[var(--color-interactive)]" />
                    </th>
                  )}
                  {columns.map((c) => {
                    const sortable = c.sortable ?? !!c.value;
                    const active = sort?.key === c.key;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        style={{ width: c.width }}
                        aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                        className={cx('h-8 whitespace-nowrap px-3 text-2xs font-semibold uppercase tracking-wide text-text-muted', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')}
                      >
                        {sortable ? (
                          <button
                            className={cx('inline-flex items-center gap-1 uppercase hover:text-text', active && 'text-text')}
                            onClick={() => setSort(active ? { key: c.key, dir: sort!.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: typeof c.value?.(filtered[0]!) === 'number' ? 'desc' : 'asc' })}
                          >
                            {c.header}
                            {active && (sort!.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                          </button>
                        ) : (
                          c.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageRows.map((row) => {
                  const k = rowKey(row);
                  return (
                    <tr
                      key={k}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                      className={cx(rowH, 'group transition-colors', onRowClick && 'cursor-pointer hover:bg-surface-muted/60 focus:bg-surface-muted/60 focus:outline-none', sel.has(k) && 'bg-interactive-soft/40', rowClassName?.(row))}
                    >
                      {selectable && (
                        <td className="px-3" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label={t('table.selectRow')} checked={sel.has(k)} onChange={() => toggle(k)} className="size-3.5 accent-[var(--color-interactive)]" />
                        </td>
                      )}
                      {columns.map((c) => (
                        <td key={c.key} className={cx('px-3 py-1.5', c.align === 'right' ? 'text-right tabular' : c.align === 'center' ? 'text-center' : '', c.className)}>
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              {footer && <tfoot className="border-t border-border bg-surface-muted/40 font-semibold">{footer}</tfoot>}
            </table>
          </div>
          {/* Mobile stacked list */}
          <ul className="divide-y divide-border md:hidden">
            {pageRows.map((row) => {
              const primary = columns.filter((c) => c.priority === 'primary');
              const secondary = columns.filter((c) => c.priority === 'secondary');
              const shown = primary.length ? primary : columns.slice(0, 1);
              const meta = secondary.length ? secondary : columns.slice(1, 3);
              return (
                <li key={rowKey(row)}>
                  <div role={onRowClick ? 'button' : undefined} tabIndex={onRowClick ? 0 : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      {shown.map((c) => (
                        <div key={c.key} className="min-w-0 text-sm">
                          {c.cell(row)}
                        </div>
                      ))}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                        {meta.map((c) => (
                          <span key={c.key} className="inline-flex items-center gap-1">
                            {c.cell(row)}
                          </span>
                        ))}
                      </div>
                    </div>
                    {onRowClick && <ChevronRight className="size-4 shrink-0 text-text-faint" />}
                  </div>
                </li>
              );
            })}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-text-muted">
              <span className="tabular">
                {t('table.range', { from: page * pageSize + 1, to: Math.min(filtered.length, (page + 1) * pageSize), total: filtered.length })}
              </span>
              <div className="flex gap-1">
                <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded-sm border border-border px-2 py-0.5 disabled:opacity-40">
                  {t('common.previous')}
                </button>
                <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="rounded-sm border border-border px-2 py-0.5 disabled:opacity-40">
                  {t('common.next')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function PageHeader({ title, description, actions, breadcrumbs, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumbs?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3">
      {breadcrumbs && <nav aria-label={t('common.breadcrumb')} className="text-xs text-text-muted">{breadcrumbs}</nav>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mb-4 flex flex-wrap items-center gap-2', className)}>{children}</div>;
}
