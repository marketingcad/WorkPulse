'use client';
import { useEffect, useState } from 'react';
import type { OffsetPage } from '@tallywork/contracts';
import type { ServerPagination } from '@tallywork/ui';

export const PAGE_SIZES = [25, 50, 100, 200];

/** A search box whose term is applied once typing pauses, rather than on every keystroke. */
export function useSearch(delay = 300) {
  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    if (input.trim() === term) return;
    const id = setTimeout(() => setTerm(input.trim()), delay);
    return () => clearTimeout(id);
  }, [input, term, delay]);
  return { input, setInput, term };
}

export interface ServerPage {
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  /** Query parameters for the API (`page` is 1-based there). */
  params: { page: number; page_size: number };
  /** Props for DataTable's `pagination`. */
  pagination: (data: OffsetPage<unknown> | undefined) => ServerPagination;
}

/**
 * Page state for a list the server pages (`?page=&page_size=`; 0-based here, 1-based on the wire).
 * `filters` is a stable string of everything that changes the result: when it changes, go back to page 1.
 */
export function useServerPage(filters: string, initialSize = 50): ServerPage {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialSize);
  const [seen, setSeen] = useState(filters);
  if (seen !== filters) {
    setSeen(filters);
    setPage(0);
  }
  return {
    page,
    pageSize,
    setPage,
    params: { page: page + 1, page_size: pageSize },
    pagination: (data) => ({
      page,
      pageSize,
      total: data?.total ?? 0,
      onPageChange: setPage,
      onPageSizeChange: (size) => {
        // Keep the first row on screen in view at the new size.
        setPage(Math.floor((page * pageSize) / size));
        setPageSize(size);
      },
      pageSizeOptions: PAGE_SIZES,
    }),
  };
}

/** Rows can disappear under you (deleted elsewhere): if the page is now past the end, show the last one. */
export function useClampPage(paging: ServerPage, data: OffsetPage<unknown> | undefined, isPlaceholder: boolean) {
  const { page, pageSize, setPage } = paging;
  useEffect(() => {
    if (data && !isPlaceholder && page > 0 && page * pageSize >= data.total) setPage(Math.max(0, Math.ceil(data.total / pageSize) - 1));
  }, [data, isPlaceholder, page, pageSize, setPage]);
}
