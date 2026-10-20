'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download } from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';

// Matches the md Button, for links that start a download.
const LINK_BUTTON = 'inline-flex h-9 w-full items-center justify-center gap-2 rounded-sm border px-3.5 text-sm font-medium transition-colors';

export interface DownloadLinks {
  windows: string | null;
  macos: string | null;
  /** The .deb (Ubuntu, Debian and derivatives): apt installs its dependencies and its sandbox profile. */
  linux: string | null;
  /** Other distributions; needs libfuse2. */
  linuxAppImage: string | null;
}

type Platform = 'windows' | 'macos' | 'linux';
const PLATFORMS: Platform[] = ['windows', 'macos', 'linux'];
const LABELS: Record<Platform, string> = { windows: 'Windows', macos: 'macOS', linux: 'Ubuntu / Debian (.deb)' };

function detectPlatform(): Platform | null {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return null;
}

/** Shown once the installer download starts: what to do with the file, first install or update. */
const AFTER_DOWNLOAD = {
  windows: ['download.after.windows.title', ['download.after.windows.step1', 'download.after.windows.step2', 'download.after.windows.step3'], 'download.after.windows.update'],
  macos: ['download.after.macos.title', ['download.after.macos.step1', 'download.after.macos.step2', 'download.after.macos.step3'], 'download.after.macos.update'],
} as const;

function AfterDownload({ platform }: { platform: keyof typeof AFTER_DOWNLOAD }) {
  const [title, steps, update] = AFTER_DOWNLOAD[platform];
  return (
    <section role="status" aria-labelledby="after-download-title" className="flex flex-col gap-3 rounded-sm border border-border bg-surface-sunken px-4 py-3">
      <h2 id="after-download-title" className="text-sm font-semibold text-text">
        {t(title)}
      </h2>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-text">
        {steps.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>
      <p className="text-xs text-text-muted">{t(update)}</p>
    </section>
  );
}

/** Workers use Tallywork through the desktop app only: this page is where they get it. */
export function DesktopDownload({ links }: { links: DownloadLinks }) {
  const router = useRouter();
  const welcome = useSearchParams().get('welcome') === '1';
  const [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => setPlatform(detectPlatform()), []);
  // The installer the person clicked, so the steps match the file they got.
  const [downloaded, setDownloaded] = useState<Platform | null>(null);

  const available = PLATFORMS.filter((p) => links[p]);
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
              <a href={links[primary]!} download onClick={() => setDownloaded(primary)} className={`${LINK_BUTTON} border-transparent bg-interactive text-on-accent hover:bg-interactive-hover`}>
                <Download className="size-4" aria-hidden />
                {t('download.for', { platform: LABELS[primary] })}
              </a>
            )}
            {others.map((p) => (
              <a key={p} href={links[p]!} download onClick={() => setDownloaded(p)} className={`${LINK_BUTTON} border-border bg-surface text-text shadow-[0_1px_2px_rgb(15_23_42/0.05)] hover:border-border-strong hover:bg-surface-muted`}>
                {t('download.for', { platform: LABELS[p] })}
              </a>
            ))}
          </div>
        )}
        {/* Once the installer's own steps show, the general steps would only repeat them. */}
        {downloaded === 'windows' || downloaded === 'macos' ? (
          <AfterDownload platform={downloaded} />
        ) : (
          <ol className="flex flex-col gap-3 text-sm text-text">
            {(['download.step1', 'download.step2', 'download.step3'] as const).map((key, i) => (
              <li key={key} className="flex items-start gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-interactive/10 text-xs font-bold text-interactive">{i + 1}</span>
                <span className="pt-0.5">{t(key)}</span>
              </li>
            ))}
          </ol>
        )}
        {/* The Mac build is not notarized yet, and AppImages must be marked executable. */}
        {platform === 'macos' && links.macos && downloaded !== 'macos' && <p className="rounded-sm bg-surface-sunken px-3 py-2 text-xs text-text-muted">{t('download.macNote')}</p>}
        {platform === 'linux' && (links.linux || links.linuxAppImage) && (
          <p className="rounded-sm bg-surface-sunken px-3 py-2 text-xs text-text-muted">
            {t('download.linuxNote')}
            {links.linuxAppImage && (
              <>
                {' '}
                <a href={links.linuxAppImage} download className="font-medium text-interactive hover:underline">
                  {t('download.linuxAppImage')}
                </a>
              </>
            )}
          </p>
        )}
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
