import type { Metadata, Viewport } from 'next';
import { Inter, Poppins } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// Brand wordmark only (BrandLockup in packages/ui/src/logo.tsx).
const brand = Poppins({ subsets: ['latin'], weight: '700', variable: '--font-brand', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'WorkPulse', template: '%s · WorkPulse' },
  description: 'Time tracking, activity, timesheets and billing for teams.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0f2240' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1628' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${brand.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before paint (no flash). */}
        <script id="theme" dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('tw.theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}" }} />
      </head>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2 focus:shadow-overlay">
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
