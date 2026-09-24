import type { NextConfig } from 'next';

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
        ],
      },
    ];
  },
};

export default config;
