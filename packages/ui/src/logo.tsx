/**
 * Tallywork mark: four tally strokes crossed by a diagonal that doubles as a clock hand.
 */
export function Logo({ size = 24, className, title = 'Tallywork' }: { size?: number; className?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} role="img" aria-label={title}>
      <rect width="32" height="32" rx="7" fill="currentColor" opacity="0.14" />
      <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <path d="M9 8.5v15" />
        <path d="M13.3 8.5v15" />
        <path d="M17.6 8.5v15" />
        <path d="M21.9 8.5v15" />
      </g>
      <path d="M6.5 21 25.5 11" stroke="#5B8DEF" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="25.5" cy="11" r="2.1" fill="#5B8DEF" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Logo size={22} />
      <span style={{ fontWeight: 700, letterSpacing: '-0.02em', fontSize: 15 }}>Tallywork</span>
    </span>
  );
}
