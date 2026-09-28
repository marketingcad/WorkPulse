'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

// Matches the md Button, for links that start a download.
const LINK_BUTTON = 'inline-flex h-9 w-full items-center justify-center gap-2 rounded-sm border border-transparent px-3.5 text-sm font-medium transition-colors';

export interface DownloadLinks {
  windows: string | null;
  macos: string | null;
  linux: string | null;
}

type Platform = keyof DownloadLinks;
const LABELS: Record<Platform, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };

function detectPlatform(): Platform | null {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return null;
}

/** Workers use Tallywork through the desktop app only: this page is where they get it. */
export function DesktopDownload({ links }: { links: DownloadLinks }) {
  const router = useRouter();
  const welcome = useSearchParams().get('welcome') === '1';
  const [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => setPlatform(detectPlatform()), []);

  const available = (Object.keys(links) as Platform[]).filter((p) => links[p]);
  const primary = platform && links[platform] ? platform : null;
  const others = available.filter((p) => p !== primary);

  return (
    <AuthShell title={t('download.title')} subtitle={welcome ? t('download.welcome') : t('download.subtitle')}>
      <div className="flex flex-col gap-5">
        {available.length === 0 ? (
          <p className="rounded-sm bg-surface-sunken px-3 py-2 text-sm text-text-muted">{t('download.notConfigured')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {primary && (
              <a href={links[primary]!} download className={`${LINK_BUTTON} bg-interactive text-on-accent hover:bg-interactive-hover`}>
                <Download className="size-4" aria-hidden />
                {t('download.for', { platform: LABELS[primary] })}
              </a>
            )}
            {others.map((p) => (
              <a key={p} href={links[p]!} download className={`${LINK_BUTTON} border-border bg-surface text-text hover:border-border-strong hover:bg-surface-muted`}>
                {t('download.for', { platform: LABELS[p] })}
              </a>
            ))}
          </div>
        )}
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-text">
          <li>{t('download.step1')}</li>
          <li>{t('download.step2')}</li>
          <li>{t('download.step3')}</li>
        </ol>
        {/* The Mac build is not notarized yet, and AppImages must be marked executable. */}
        {platform === 'macos' && links.macos && <p className="rounded-sm bg-surface-sunken px-3 py-2 text-xs text-text-muted">{t('download.macNote')}</p>}
        {platform === 'linux' && links.linux && <p className="rounded-sm bg-surface-sunken px-3 py-2 text-xs text-text-muted">{t('download.linuxNote')}</p>}
        <button
          type="button"
          className="self-start text-sm text-text-muted hover:text-text hover:underline"
          onClick={async () => {
            await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
            router.replace('/login');
          }}
        >
          {t('download.signOut')}
        </button>
      </div>
    </AuthShell>
  );
}
