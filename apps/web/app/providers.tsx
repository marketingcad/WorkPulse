'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@tallywork/ui';
import { ApiError } from '@/lib/api';
import { useLocale } from '@/lib/i18n';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  // Text and formatting are read from the process-wide locale at render time, so the page tree
  // is re-rendered (keyed) when it changes. It only changes when the effective locale does.
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <LocaleBoundary key={locale}>{children}</LocaleBoundary>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function LocaleBoundary({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
