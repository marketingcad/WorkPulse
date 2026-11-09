import { useId } from 'react';
import { Sparkles } from 'lucide-react';
import { clsx as cx } from 'clsx';
import { t } from './i18n';

/**
 * Brand mark: a pulse line inside a hexagon. Same drawing as apps/web/app/icon.svg (the favicon);
 * the desktop app icon (apps/desktop/build/icon.svg) places it on a dark rounded square.
 */
export function Logo({ size = 24, className, title = 'WorkPulse' }: { size?: number; className?: string; title?: string }) {
  // Unique per instance so several logos on one page do not share a clip path.
  const clip = `wp-inner-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label={title}>
      <defs>
        <clipPath id={clip}>
          <path d="M32 12.5 49 22.25v19.5L32 51.5 15 41.75v-19.5Z" />
        </clipPath>
      </defs>
      <path d="M32 5.5 55 18.75v26.5L32 58.5 9 45.25v-26.5Z" fill="#1766FF" stroke="#1766FF" strokeWidth="7" strokeLinejoin="round" />
      <path d="M32 12.5 49 22.25v19.5L32 51.5 15 41.75v-19.5Z" fill="#0B2A66" stroke="#0B2A66" strokeWidth="4" strokeLinejoin="round" />
      <path d="M9 41 22.5 26.5 32.5 41.5 41.5 28.5 56 37" fill="none" stroke="#FFFFFF" strokeWidth="6.4" strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#${clip})`} />
    </svg>
  );
}

type Tone = 'auto' | 'onDark';

/**
 * Public brand lockup: mark + "WorkPulse" wordmark, with an optional "Powered by AI" badge and the
 * tagline. Used on the signed-out pages, the client portal and the support console. The wordmark is
 * always the largest element; the badge and the tagline sit under it, smaller and muted.
 * `tone="onDark"` is for dark panels; the default follows the page theme ("Work" uses the text colour).
 * The wordmark uses --font-brand (Poppins Bold, loaded in apps/web/app/layout.tsx).
 */
export function BrandLockup({
  size = 32,
  descriptor = false,
  tagline = false,
  tone = 'auto',
  className,
}: {
  size?: number;
  /** Show the "Powered by AI" badge under the wordmark. */
  descriptor?: boolean;
  /** Show the tagline, "Smarter Workforce. Better Business." */
  tagline?: boolean;
  tone?: Tone;
  className?: string;
}) {
  const onDark = tone === 'onDark';
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.32 }}>
      <Logo size={size} title={t('brand.name')} />
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1 }}>
        <span style={{ fontFamily: 'var(--font-brand), var(--font-inter), system-ui, sans-serif', fontWeight: 700, fontSize: size * 0.72, letterSpacing: '-0.01em' }}>
          <span className={onDark ? undefined : 'text-text'} style={onDark ? { color: '#FFFFFF' } : undefined}>
            Work
          </span>
          <span style={{ color: onDark ? '#4D8DFF' : '#1766FF' }}>Pulse</span>
        </span>
        {descriptor && <AiBadge tone={tone} className="mt-2" />}
        {tagline && (
          <span data-testid="brand-tagline" className={onDark ? undefined : 'text-text-muted'} style={{ fontSize: Math.max(11, size * 0.26), marginTop: size * 0.16, letterSpacing: '0.01em', ...(onDark ? { color: '#B4C2DA' } : {}) }}>
            {t('brand.tagline')}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * The subtle "Powered by AI" badge: a small pill with a sparkle, always secondary to the WorkPulse
 * name. `tone="onDark"` is for dark surfaces (the sidebar, brand panels). `iconOnly` keeps just the
 * sparkle, with the words for screen readers and as a tooltip, for the collapsed sidebar.
 */
export function AiBadge({ tone = 'auto', iconOnly = false, className }: { tone?: Tone; iconOnly?: boolean; className?: string }) {
  const label = t('brand.descriptor');
  return (
    <span
      data-testid="ai-badge"
      title={iconOnly ? label : undefined}
      className={cx(
        'inline-flex shrink-0 items-center gap-1 rounded-full border font-medium leading-none tracking-wide',
        iconOnly ? 'p-1' : 'px-2 py-[3px] text-[10.5px]',
        tone === 'onDark' ? 'border-[#4d8dff]/35 bg-[#4d8dff]/15 text-[#bcd3ff]' : 'border-interactive/25 bg-interactive-soft text-interactive',
        className,
      )}
    >
      <Sparkles className={iconOnly ? 'size-3' : 'size-2.5'} aria-hidden />
      {iconOnly ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}

/**
 * The brand line for footers: "WorkPulse – Powered by AI · Smarter Workforce. Better Business."
 * Wraps onto two lines on narrow screens.
 */
export function BrandSignature({ tone = 'auto', className }: { tone?: Tone; className?: string }) {
  const onDark = tone === 'onDark';
  return (
    <p data-testid="brand-signature" className={cx('flex flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 text-center text-xs', onDark ? 'text-[#9fb0cf]' : 'text-text-muted', className)}>
      {/* Real spaces between the parts (flex gap is only visual), so the text and screen readers read it whole. */}
      <span className={cx('font-semibold', onDark ? 'text-[#dbe4f5]' : 'text-text')}>{t('brand.signature')}</span>{' '}
      <span aria-hidden>·</span> <span>{t('brand.tagline')}</span>
    </p>
  );
}
