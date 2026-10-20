'use client';
import Link from 'next/link';
import { LifeBuoy } from 'lucide-react';
import { useOrg } from '@/lib/org';

/** "Help" next to a page title: opens the Help Center at the guide for this page. */
export function HelpLink({ article, label = 'Help' }: { article: string; label?: string }) {
  const org = useOrg();
  return (
    <Link href={`${org.base}/help#${article}`} className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-sm font-medium text-text-muted hover:bg-surface-muted hover:text-text" aria-label={`${label}: how to use this page`}>
      <LifeBuoy className="size-3.5" aria-hidden />
      {label}
    </Link>
  );
}
