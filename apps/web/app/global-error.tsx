'use client';
import { useEffect } from 'react';
import './globals.css';

/**
 * The root layout itself failed: this replaces the whole document, so it brings its own <html>,
 * styles and saved theme (audit 30 Oct 2026, VF-12).
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  useEffect(() => {
    console.error(error);
    try {
      const theme = localStorage.getItem('tw.theme');
      if (theme) document.documentElement.setAttribute('data-theme', theme);
    } catch {
      /* ignore */
    }
  }, [error]);
  return (
    <html lang="en">
      <body>
        <title>Something went wrong · WorkPulse</title>
        <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-xl font-semibold text-text">Something went wrong</h1>
          <p className="max-w-sm text-sm text-text-muted">WorkPulse could not load. Try again in a moment.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => retry()} className="inline-flex h-10 items-center rounded-sm bg-interactive px-4 text-sm font-semibold text-on-accent hover:bg-interactive-hover">
              Try again
            </button>
            {/* A full page load, not client navigation: the app shell is what failed. */}
            <a href="/" className="inline-flex h-10 items-center rounded-sm border border-border px-4 text-sm font-semibold text-text hover:bg-surface-muted">
              Go to your workspace
            </a>
          </div>
          {digest && <p className="text-xs text-text-faint">Reference: {digest}</p>}
        </main>
      </body>
    </html>
  );
}
