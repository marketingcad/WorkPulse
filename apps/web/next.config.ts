import type { NextConfig } from 'next';

/**
 * Content Security Policy (audit 29 Oct 2026, SEC-13): defense in depth should an XSS ever slip in.
 * Scripts, requests, fonts and images come from this site only, with no plugins, no <base> rewriting,
 * no framing and no form posting elsewhere. Inline scripts stay allowed (Next's bootstrap and the theme
 * script are inline); the development server also needs eval and its websocket.
 */
const dev = process.env.NODE_ENV !== 'production';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const config: NextConfig = {
  transpilePackages: ['@tallywork/api', '@tallywork/contracts', '@tallywork/db', '@tallywork/domain', '@tallywork/ui'],
  serverExternalPackages: ['@electric-sql/pglite', '@node-rs/argon2', 'pg', 'exceljs', 'pdf-lib'],
  poweredByHeader: false,
  typedRoutes: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

export default config;
