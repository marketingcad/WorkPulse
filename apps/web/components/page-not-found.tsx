import Link from 'next/link';
import { Logo } from '@tallywork/ui';

/**
 * Unknown addresses (and notFound() anywhere): say so, and give a way back (audit 30 Oct 2026, VF-12).
 * Also shown for an organization that does not exist or that the person is not a member of (QA audit
 * 11 Nov 2026, BUG-07), which used to show a raw error with a "Try again" that could never work.
 */
export function PageNotFound({ title = false }: { title?: boolean }) {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      {/* Pages rendered by not-found.tsx get the title from its metadata; others set it here. */}
      {title && <title>Page not found</title>}
      <Logo size={36} className="text-[#0f2240] dark:text-white" />
      <h1 className="text-xl font-semibold text-text">Page not found</h1>
      <p className="max-w-sm text-sm text-text-muted">The address may be mistyped, or the page has moved. Check the link, or go back to your workspace.</p>
      <Link
        href="/"
        className="inline-flex h-10 items-center rounded-sm border border-transparent bg-interactive px-4 text-sm font-semibold text-on-accent shadow-button hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
      >
        Go to your workspace
      </Link>
    </main>
  );
}
