import { Suspense } from 'react';
import { DesktopDownload, type DownloadLinks } from '@/components/desktop-download';

// Installer links are read when the page is requested, so changing them needs no rebuild.
export const dynamic = 'force-dynamic';

export default function DownloadPage() {
  const links: DownloadLinks = {
    windows: process.env.DESKTOP_DOWNLOAD_URL_WINDOWS || null,
    macos: process.env.DESKTOP_DOWNLOAD_URL_MACOS || null,
    linux: process.env.DESKTOP_DOWNLOAD_URL_LINUX || null,
    linuxAppImage: process.env.DESKTOP_DOWNLOAD_URL_LINUX_APPIMAGE || null,
  };
  return (
    <Suspense>
      <DesktopDownload links={links} />
    </Suspense>
  );
}
