'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { Button, Logo } from '@tallywork/ui';

/**
 * A page that failed to render: a plain message, a retry and a way back, instead of the framework's
 * default screen (audit 30 Oct 2026, VF-12). The reference matches the server log for the error.
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo size={36} className="text-[#0f2240] dark:text-white" />
      <h1 className="text-xl font-semibold text-text">Something went wrong</h1>
      <p className="max-w-sm text-sm text-text-muted">This page could not be shown. Try again, or go back to your workspace. Nothing you saved before this was lost.</p>
      <div className="flex gap-2">
        <Button variant="primary" size="md" onClick={() => retry()}>
          Try again
        </Button>
        <Link href="/" className="inline-flex h-10 items-center rounded-sm border border-border px-4 text-sm font-semibold text-text hover:bg-surface-muted">
          Go to your workspace
        </Link>
      </div>
      {digest && <p className="text-xs text-text-faint">Reference: {digest}</p>}
    </main>
  );
}
