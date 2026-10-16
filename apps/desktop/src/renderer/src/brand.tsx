import { useId } from 'react';

/** Brand mark (same drawing as the web Logo in packages/ui/src/logo.tsx). */
export function Mark({ size = 32 }: { size?: number }) {
  const clip = `wp-inner-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="WorkPulse">
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
