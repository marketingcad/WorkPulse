import { useId } from 'react';

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

/**
 * Public brand lockup: mark + "WorkPulse" wordmark (+ optional tagline), used on the signed-out pages.
 * `tone="onDark"` is for dark panels; the default follows the page theme ("Work" uses the text colour).
 * The wordmark uses --font-brand (Poppins Bold, loaded in apps/web/app/layout.tsx).
 */
export function BrandLockup({ size = 32, tagline = false, tone = 'auto', className }: { size?: number; tagline?: boolean; tone?: 'auto' | 'onDark'; className?: string }) {
  const onDark = tone === 'onDark';
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.32 }}>
      <Logo size={size} title="WorkPulse" />
      <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1 }}>
        <span style={{ fontFamily: 'var(--font-brand), var(--font-inter), system-ui, sans-serif', fontWeight: 700, fontSize: size * 0.72, letterSpacing: '-0.01em' }}>
          <span className={onDark ? undefined : 'text-text'} style={onDark ? { color: '#FFFFFF' } : undefined}>
            Work
          </span>
          <span style={{ color: onDark ? '#4D8DFF' : '#1766FF' }}>Pulse</span>
        </span>
        {tagline && (
          <span className={onDark ? undefined : 'text-text-muted'} style={{ fontSize: Math.max(10, size * 0.27), marginTop: size * 0.12, letterSpacing: '0.02em', ...(onDark ? { color: '#93A3BD' } : {}) }}>
            Track <span aria-hidden>•</span> Focus <span aria-hidden>•</span> Achieve
          </span>
        )}
      </span>
    </span>
  );
}
