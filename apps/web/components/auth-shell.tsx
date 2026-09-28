'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { BrandLockup, fmtClock } from '@tallywork/ui';
import { t, useBrowserLocale } from '@/lib/i18n';

/** Split auth layout: brand instrument panel (desktop) + form. */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  // Signed out: there is no account setting yet, so dates and numbers follow the browser.
  useBrowserLocale();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="instrument-grid relative hidden flex-col justify-between overflow-hidden bg-[#0f2240] p-10 text-[#e6ecf5] lg:flex">
        <Link href="/" className="self-start" aria-label="WorkPulse home">
          <BrandLockup size={52} tagline tone="onDark" />
        </Link>
        <InstrumentPreview />
        <p className="max-w-sm text-sm text-[#93a3bd]">{t('auth.tagline')}</p>
      </aside>
      <main id="main" className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <BrandLockup size={34} tagline />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-text-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          {footer && <div className="mt-6 text-sm text-text-muted">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

/** A quiet, live "instrument": the product's core idea rendered with real UI parts. */
function InstrumentPreview() {
  const [s, setS] = useState(3 * 3600 + 42 * 60 + 18);
  useEffect(() => {
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const bars = [62, 78, 45, 88, 71, 93, 56, 80, 67, 74, 38, 85];
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-[1px]">
        <div className="flex items-center justify-between text-xs text-[#93a3bd]">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[#3fb27f]" /> {t('auth.preview.tracking')}
          </span>
          <span>{t('auth.preview.project')}</span>
        </div>
        <div className="tabular mt-4 text-center font-mono text-5xl font-medium tracking-tight text-white">{fmtClock(s)}</div>
        <div className="mt-1 text-center text-xs text-[#93a3bd]">{t('auth.preview.task')}</div>
        <div className="mt-6 flex h-16 items-end gap-1.5" aria-hidden>
          {bars.map((b, i) => (
            <span key={i} className="flex-1 rounded-t-[2px] bg-[#6368d2]" style={{ height: `${b}%`, opacity: 0.35 + (b / 100) * 0.65 }} />
          ))}
        </div>
        <div className="mt-2 flex justify-between font-mono text-[10px] text-[#8594ad]">
          <span>09:00</span>
          <span>{t('auth.preview.axis')}</span>
          <span>11:00</span>
        </div>
      </div>
    </div>
  );
}
