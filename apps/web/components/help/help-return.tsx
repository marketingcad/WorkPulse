'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, X } from 'lucide-react';
import { useOrg } from '@/lib/org';

const KEY = 'tw.help.return';

/** Remember the guide someone was reading when they follow one of its links (this browser tab only). */
export function rememberHelpArticle(article: { id: string; title: string }) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(article));
  } catch {
    /* storage unavailable: the bar simply doesn't show */
  }
}

/**
 * After following a link from a Help guide, a slim bar leads back to that guide, so it can be
 * finished step by step. Hidden on Help itself and once dismissed.
 */
export function HelpReturnBar() {
  const org = useOrg();
  const pathname = usePathname();
  const [article, setArticle] = useState<{ id: string; title: string } | null>(null);
  const onHelp = pathname === `${org.base}/help`;
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      setArticle(raw ? (JSON.parse(raw) as { id: string; title: string }) : null);
    } catch {
      setArticle(null);
    }
  }, [pathname]);
  if (!article || onHelp) return null;
  const dismiss = () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setArticle(null);
  };
  return (
    <div role="region" aria-label="Help guide" className="-mt-2 mb-4 flex items-center gap-2 rounded-sm border border-interactive/30 bg-interactive-soft px-3 py-1.5 text-sm">
      <Link href={`${org.base}/help#${article.id}`} className="inline-flex min-w-0 items-center gap-1.5 font-medium text-interactive hover:underline">
        <ArrowLeft className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">Back to Help: {article.title}</span>
      </Link>
      <button onClick={dismiss} className="ml-auto rounded-sm p-1 text-text-muted hover:bg-surface hover:text-text" aria-label="Hide the link back to Help">
        <X className="size-3.5" />
      </button>
    </div>
  );
}
