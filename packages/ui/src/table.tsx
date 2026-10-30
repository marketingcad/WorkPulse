'use client';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
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
  /** Rows per page for client pagination (the starting value; people can change it). */
  pageSize?: number;
  /** Choices for "Rows per page". `pageSize` is always included. */
  pageSizeOptions?: number[];
  /**
   * Server pagination: `rows` is already one page, and paging is controlled by the caller.
   * Client search and sorting then only see the current page, so pair this with server-side filters.
   */
  pagination?: ServerPagination;
  caption?: string;
}

export interface ServerPagination {
  /** 0-based */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

const DEFAULT_PAGE_SIZES = [25, 50, 100];

/**
 * Accessible, dense data table with sorting, search, selection + bulk bar,
 * client (or server) pagination, and a stacked card layout on small screens.
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
  pageSize: initialPageSize = 100,
  pageSizeOptions,
  pagination,
  caption,
}: DataTableProps<T>) {
  const [sort, setSortState] = useState(initialSort ?? null);
  const [q, setQ] = useState('');
  const [clientPage, setPage] = useState(0);
  const [clientPageSize, setClientPageSize] = useState(initialPageSize);
  const setSort = (s: { key: string; dir: 'asc' | 'desc' }) => {
    setSortState(s);
    setPage(0);
  };

  // A different data set (the caller changed a filter, switched period, …) starts again at page 1.
  // Refetches and edits that keep the same first row stay on the current page.
  const firstKey = rows?.length ? rowKey(rows[0]!) : null;
  const [prevFirstKey, setPrevFirstKey] = useState(firstKey);
  if (firstKey !== prevFirstKey) {
    setPrevFirstKey(firstKey);
    setPage(0);
  }

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

  const sizeChoices = useMemo(() => [...new Set([...(pageSizeOptions ?? DEFAULT_PAGE_SIZES), initialPageSize])].sort((a, b) => a - b), [pageSizeOptions, initialPageSize]);
  const pageSize = pagination ? pagination.pageSize : clientPageSize;
  const total = pagination ? pagination.total : filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Clamp so rows removed by a search, refetch or delete never leave an empty page behind.
  const page = Math.min(pagination ? pagination.page : clientPage, pages - 1);
  const pageRows = pagination ? filtered : filtered.slice(page * pageSize, (page + 1) * pageSize);
  const changePageSize = (size: number) => {
    // Keep the first row of the current page in view.
    setPage(Math.floor((page * clientPageSize) / size));
    setClientPageSize(size);
  };
  // Client tables up to one page look as before; the footer shows once there is more than one page,
  // or after someone picked a smaller page size (so they can switch back). Server tables always show it.
  const showPager = pagination ? total > 0 : pages > 1 || clientPageSize !== initialPageSize;
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
                className="h-8 w-full rounded-sm border border-border bg-surface pl-7 pr-2 text-sm placeholder:text-text-faint focus:border-interactive focus:outline-none focus:ring-2 focus:ring-interactive/20"
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
          {/* Desktop/tablet table. `relative` keeps absolutely positioned content (e.g. sr-only headers) inside the scroll box, instead of widening the page (audit QA-05). */}
          <div className="relative hidden overflow-x-auto md:block">
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
                        className={cx('h-10 whitespace-nowrap px-3 text-2xs font-semibold uppercase tracking-wide text-text-muted', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left')}
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
          {showPager &&
            (pagination ? (
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={pagination.onPageChange} onPageSizeChange={pagination.onPageSizeChange} pageSizeOptions={pagination.pageSizeOptions} />
            ) : (
              <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={changePageSize} pageSizeOptions={sizeChoices} />
            ))}
        </>
      )}
    </div>
  );
}

/**
 * Page buttons to show for `pages` pages around the 0-based `page`, with 'gap' for elided runs:
 * 1 2 3 4 5 … 20, 1 … 9 10 11 … 20, 1 … 16 17 18 19 20. Always the same length once elided,
 * so the buttons don't jump around while paging.
 */
export function pageItems(page: number, pages: number): Array<number | 'gap'> {
  const slots = 7;
  if (pages <= slots) return Array.from({ length: pages }, (_, i) => i);
  const last = pages - 1;
  if (page <= 3) return [0, 1, 2, 3, 4, 'gap', last];
  if (page >= last - 3) return [0, 'gap', last - 4, last - 3, last - 2, last - 1, last];
  return [0, 'gap', page - 1, page, page + 1, 'gap', last];
}

const pagerBtn = 'inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-sm border px-1.5 tabular transition-colors disabled:cursor-not-allowed disabled:opacity-40';

/** "Showing 1–25 of 240 results", rows per page, and Previous / numbered pages / Next. `page` is 0-based. */
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions, className }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void; onPageSizeChange?: (size: number) => void; pageSizeOptions?: number[]; className?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const from = current * pageSize + 1;
  const to = Math.min(total, (current + 1) * pageSize);
  const sizeId = useId();
  return (
    <div className={cx('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-3 py-2 text-xs text-text-muted', className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="tabular" aria-live="polite">
          {total > 0 ? t('table.range', { from, to, total }) : t('table.noRange')}
        </span>
        {onPageSizeChange && pageSizeOptions && pageSizeOptions.length > 1 && (
          <span className="flex items-center gap-1.5">
            <label htmlFor={sizeId}>{t('table.perPage')}</label>
            <select id={sizeId} value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))} className="h-7 rounded-sm border border-border bg-surface px-1.5 text-xs text-text focus:border-interactive focus:outline-none">
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </span>
        )}
      </div>
      {pages > 1 && (
        <nav aria-label={t('table.pagination')} className="flex items-center gap-1">
          <button type="button" disabled={current === 0} onClick={() => onPageChange(current - 1)} aria-label={t('table.previousPage')} className={cx(pagerBtn, 'border-border hover:enabled:bg-surface-muted hover:enabled:text-text')}>
            <ChevronLeft className="size-3.5" aria-hidden />
            <span className="hidden pr-0.5 sm:inline">{t('common.previous')}</span>
          </button>
          {/* Phones: compact "Page 3 of 12"; tablet and up: numbered buttons. */}
          <span className="tabular px-1.5 sm:hidden">{t('table.pageOf', { page: current + 1, pages })}</span>
          <ul className="hidden items-center gap-1 sm:flex">
            {pageItems(current, pages).map((p, i) =>
              p === 'gap' ? (
                <li key={`gap-${i}`} aria-hidden className="px-0.5 text-text-faint">
                  …
                </li>
              ) : (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => onPageChange(p)}
                    aria-label={t('table.goToPage', { page: p + 1 })}
                    aria-current={p === current ? 'page' : undefined}
                    className={cx(pagerBtn, p === current ? 'border-interactive bg-interactive-soft font-semibold text-interactive' : 'border-border hover:bg-surface-muted hover:text-text')}
                  >
                    {p + 1}
                  </button>
                </li>
              ),
            )}
          </ul>
          <button type="button" disabled={current >= pages - 1} onClick={() => onPageChange(current + 1)} aria-label={t('table.nextPage')} className={cx(pagerBtn, 'border-border hover:enabled:bg-surface-muted hover:enabled:text-text')}>
            <span className="hidden pl-0.5 sm:inline">{t('common.next')}</span>
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </nav>
      )}
    </div>
  );
}

export function PageHeader({ title, description, actions, breadcrumbs, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumbs?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      {breadcrumbs && <nav aria-label={t('common.breadcrumb')} className="text-xs text-text-muted">{breadcrumbs}</nav>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
          {description && <p className="mt-1.5 text-[15px] text-text-muted">{description}</p>}
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
