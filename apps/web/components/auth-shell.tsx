'use client';
import { forwardRef, useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import Link from 'next/link';
import { BarChart3, Clock3, FileText, LayoutDashboard, Pause, Settings, ShieldCheck, TrendingUp, Users, type LucideIcon } from 'lucide-react';
import { BrandLockup, Logo, cx, fmtClock } from '@tallywork/ui';
import { t, useBrowserLocale } from '@/lib/i18n';

/**
 * Signed-out layout: a brand panel (large screens) beside a card with the form. Every sign-in,
 * sign-up and invitation page uses it, so they share one look.
 */
export function AuthShell({ title, subtitle, children, footer, secureNote = false }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; secureNote?: boolean }) {
  // Signed out: there is no account setting yet, so dates and numbers follow the browser.
  useBrowserLocale();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
      <BrandPanel />
      <main id="main" className="relative flex items-center justify-center overflow-hidden bg-bg px-4 py-10 sm:px-8">
        {/* Soft brand light behind the card. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_85%_0%,rgba(23,102,255,0.10),transparent_70%),radial-gradient(50%_40%_at_10%_100%,rgba(99,102,241,0.08),transparent_70%)]" />
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 hidden size-64 rotate-12 rounded-[38%] bg-[linear-gradient(140deg,#4f7dff_0%,#1766ff_45%,#5b3df5_100%)] opacity-90 blur-[1px] sm:block" />
        <div className="relative w-full max-w-[460px] rounded-2xl border border-border bg-surface p-7 shadow-[0_24px_60px_-28px_rgba(15,34,64,0.35)] sm:p-10">
          <Logo size={44} />
          <h1 className="mt-5 text-[28px] font-bold leading-tight tracking-tight text-text">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-text-muted">{subtitle}</p>}
          <div className="mt-8 [&_button[type=submit]]:h-11 [&_button[type=submit]]:rounded-lg [&_button[type=submit]]:text-[15px] [&_input:not([type=checkbox]):not([data-auth-input])]:h-11 [&_input:not([type=checkbox]):not([data-auth-input])]:rounded-lg [&_select]:h-11 [&_select]:rounded-lg [&_label]:text-[13px] [&_label]:font-semibold [&_label]:text-text">
            {children}
          </div>
          {footer && (
            <div className="mt-8 flex items-start gap-3 text-[13px] leading-5 text-text-muted">
              <span aria-hidden className="mt-2.5 h-px min-w-6 flex-1 bg-border" />
              <span className="max-w-[80%] text-center">{footer}</span>
              <span aria-hidden className="mt-2.5 h-px min-w-6 flex-1 bg-border" />
            </div>
          )}
          {secureNote && (
            <div className="mt-6 flex items-start gap-3 rounded-xl bg-surface-muted px-4 py-3.5">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-interactive" aria-hidden />
              <div className="text-xs leading-relaxed">
                <p className="font-semibold text-text">{t('auth.secure.title')}</p>
                <p className="text-text-muted">{t('auth.secure.body')}</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/** A tall input with a leading icon (and an optional trailing control), for the signed-out pages. */
export const AuthInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon: LucideIcon; trailing?: ReactNode }>(function AuthInput({ icon: Icon, trailing, className, ...rest }, ref) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-text-faint" aria-hidden />
      <input
        ref={ref}
        data-auth-input
        className={cx(
          'h-12 w-full rounded-lg border border-border bg-surface pl-11 text-[15px] text-text outline-none transition-colors placeholder:text-text-faint hover:border-border-strong focus:border-interactive focus:ring-2 focus:ring-interactive/20 disabled:opacity-60',
          trailing ? 'pr-11' : 'pr-3.5',
          className,
        )}
        {...rest}
      />
      {trailing && <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</div>}
    </div>
  );
});

const FEATURES: Array<{ icon: LucideIcon; tone: string; title: string; body: string }> = [
  { icon: Clock3, tone: 'bg-[#1766ff]', title: 'auth.brand.f1.title', body: 'auth.brand.f1.body' },
  { icon: BarChart3, tone: 'bg-[#6d4cf5]', title: 'auth.brand.f2.title', body: 'auth.brand.f2.body' },
  { icon: Users, tone: 'bg-[#0f9f6e]', title: 'auth.brand.f3.title', body: 'auth.brand.f3.body' },
];

/** The dark brand panel: message, three product pillars and a live product preview. */
function BrandPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-[#060d22] text-white lg:flex lg:flex-col">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_55%_at_70%_85%,rgba(37,84,255,0.55),transparent_70%),radial-gradient(45%_40%_at_100%_30%,rgba(91,61,245,0.35),transparent_70%),radial-gradient(60%_50%_at_0%_100%,rgba(23,102,255,0.45),transparent_70%)]" />
      <svg aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] w-full" viewBox="0 0 800 500" preserveAspectRatio="none">
        <path d="M0 330 C 160 250, 260 420, 430 330 S 700 160, 800 120" fill="none" stroke="rgba(77,140,255,0.55)" strokeWidth="2" />
        <path d="M0 500 L0 380 C 180 300, 330 470, 520 400 S 760 300, 800 330 L800 500 Z" fill="rgba(23,102,255,0.28)" />
      </svg>
      <div className="relative flex flex-1 flex-col px-12 pb-10 pt-11 xl:px-16">
        <Link href="/" className="self-start" aria-label="WorkPulse home">
          <BrandLockup size={56} tagline tone="onDark" />
        </Link>
        <h2 className="mt-14 text-[44px] font-extrabold leading-[1.08] tracking-tight xl:text-[52px]">
          {t('auth.brand.headline1')}
          <br />
          {t('auth.brand.headline2')} <span className="text-[#3b82ff]">{t('auth.brand.headlineAccent')}</span>
        </h2>
        <p className="mt-5 max-w-md text-[17px] leading-relaxed text-[#c7d2e8]">{t('auth.brand.body')}</p>
        <ul className="mt-9 grid max-w-2xl grid-cols-3 gap-6">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex items-start gap-3.5">
              <span className={cx('flex size-11 shrink-0 items-center justify-center rounded-xl shadow-lg', f.tone)}>
                <f.icon className="size-5" aria-hidden />
              </span>
              <span>
                <span className="block text-[15px] font-semibold">{t(f.title)}</span>
                <span className="mt-1 block text-[13px] leading-snug text-[#9fb0cf]">{t(f.body)}</span>
              </span>
            </li>
          ))}
        </ul>
        <DashboardPreview />
        <p className="mt-auto flex items-center gap-2 pt-8 text-sm text-[#c7d2e8]">
          <ShieldCheck className="size-4 text-[#3b82ff]" aria-hidden />
          {t('auth.brand.trust')}
        </p>
      </div>
    </aside>
  );
}

/** A decorative, live miniature of the dashboard (timer ticks), tilted like a device in perspective. */
function DashboardPreview() {
  const [s, setS] = useState(3 * 3600 + 44 * 60 + 13);
  useEffect(() => {
    const id = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const today = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date());
  const bars = [44, 70, 52, 66, 88, 61, 74, 95, 69, 58, 83, 77];
  const nav: Array<[LucideIcon, string]> = [
    [LayoutDashboard, 'auth.preview.nav.dashboard'],
    [Clock3, 'auth.preview.nav.time'],
    [FileText, 'auth.preview.nav.reports'],
    [Users, 'auth.preview.nav.team'],
    [Settings, 'auth.preview.nav.settings'],
  ];
  const stats: Array<[string, string, string]> = [
    ['auth.preview.stat.total', '6h 42m', '12%'],
    ['auth.preview.stat.windows', '8', '33%'],
    ['auth.preview.stat.focus', '52m', '18%'],
  ];
  return (
    <div aria-hidden className="mt-10 [perspective:1800px]">
      <div className="flex w-full max-w-[640px] origin-left rounded-2xl border border-white/10 bg-[#0b1530]/90 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)] [transform:rotateY(-10deg)_rotateX(5deg)]">
        <div className="w-40 shrink-0 border-r border-white/5 p-4">
          <div className="mb-5 flex items-center gap-2 text-sm font-bold">
            <Logo size={18} title="" />
            <span>
              Work<span className="text-[#3b82ff]">Pulse</span>
            </span>
          </div>
          <ul className="space-y-1 text-[11px] text-[#9fb0cf]">
            {nav.map(([Icon, key], i) => (
              <li key={key} className={cx('flex items-center gap-2 whitespace-nowrap rounded-md px-2 py-1.5', i === 0 && 'bg-[#1766ff]/25 text-white')}>
                <Icon className="size-3.5" />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 flex-1 p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold">{t('auth.preview.greeting')}</p>
              <p className="text-[10px] text-[#8b9bbb]">{t('auth.preview.greetingSub')}</p>
            </div>
            <span className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-[#9fb0cf]">{t('auth.preview.today', { date: today })}</span>
          </div>
          <div className="mt-3 grid grid-cols-[1.6fr_1fr] gap-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="flex items-center gap-1.5 text-[10px] text-[#9fb0cf]">
                <span className="size-1.5 rounded-full bg-[#34d399]" /> {t('auth.preview.tracking')}
              </p>
              <div className="mt-1 flex items-center justify-between">
                <span className="tabular font-mono text-[28px] font-semibold tracking-tight">{fmtClock(s)}</span>
                <span className="flex size-7 items-center justify-center rounded-full bg-[#1766ff]">
                  <Pause className="size-3.5" />
                </span>
              </div>
              <p className="text-[10px] text-[#5f9bff]">{t('auth.preview.task')}</p>
            </div>
            <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="relative size-[74px]">
                <svg viewBox="0 0 36 36" className="size-full -rotate-90">
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.5" />
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="url(#wp-ring)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="76 100" pathLength="100" />
                  <defs>
                    <linearGradient id="wp-ring" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#3b82ff" />
                      <stop offset="1" stopColor="#7c5cff" />
                    </linearGradient>
                  </defs>
                </svg>
                <span className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-sm font-bold">78%</span>
                  <span className="text-[7px] text-[#8b9bbb]">{t('auth.preview.productive')}</span>
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] font-semibold">{t('auth.preview.activity')}</p>
              <div className="mt-2 flex h-16 items-end gap-1">
                {bars.map((b, i) => (
                  <span key={i} className="flex-1 rounded-t-[3px] bg-gradient-to-t from-[#3b5bff] to-[#7c5cff]" style={{ height: `${b}%` }} />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[8px] text-[#6f81a3]">
                <span>9:00</span>
                <span>12:00</span>
                <span>15:00</span>
                <span>18:00</span>
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              {stats.map(([key, value, up]) => (
                <div key={key} className="flex items-end justify-between">
                  <span>
                    <span className="block text-[9px] text-[#8b9bbb]">{t(key)}</span>
                    <span className="text-xs font-semibold">{value}</span>
                  </span>
                  <span className="flex items-center gap-0.5 text-[9px] font-semibold text-[#34d399]">
                    <TrendingUp className="size-2.5" />
                    {up}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
