import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ImageIcon, Lightbulb } from 'lucide-react';
import { Logo } from '@tallywork/ui';
import { GUIDES, guideImagePath, isGuidePlatform, type GuidePlatform } from '@/components/download/guides';

// Built once per platform; the screenshot check below runs at build time, when public/ is on disk.
export const dynamicParams = false;
export function generateStaticParams() {
  return (Object.keys(GUIDES) as GuidePlatform[]).map((platform) => ({ platform }));
}

export async function generateMetadata({ params }: { params: Promise<{ platform: string }> }): Promise<Metadata> {
  const { platform } = await params;
  return { title: isGuidePlatform(platform) ? `Set up WorkPulse on ${GUIDES[platform].name}` : 'Setup guide' };
}

const hasImage = (platform: GuidePlatform, image: string) => existsSync(path.join(process.cwd(), 'public', 'download-guides', platform, image));

/** A step-by-step setup guide for the desktop app, with a screenshot for each step. */
export default async function SetupGuidePage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isGuidePlatform(platform)) notFound();
  const g = GUIDES[platform];
  const other = (Object.keys(GUIDES) as GuidePlatform[]).filter((p) => p !== platform);

  return (
    <main id="main" className="min-h-dvh bg-bg px-4 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Logo size={36} />
            <Link href="/download" className="inline-flex items-center gap-1.5 text-sm font-medium text-interactive hover:underline">
              <ArrowLeft className="size-4" aria-hidden /> Back to download
            </Link>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Setup guide</p>
            <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight text-text sm:text-[32px]">Set up WorkPulse on {g.name}</h1>
            <p className="mt-2 max-w-[65ch] text-[15px] leading-relaxed text-text-muted">{g.intro}</p>
          </div>
          <section aria-labelledby="before-title" className="rounded-lg border border-border bg-surface p-4">
            <h2 id="before-title" className="text-sm font-semibold text-text">
              Before you start
            </h2>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-text">
              {g.before.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </section>
        </header>

        <ol className="flex flex-col gap-6" aria-label={`Steps to set up WorkPulse on ${g.name}`}>
          {g.steps.map((s, i) => {
            const src = guideImagePath(platform, s.image);
            return (
              <li key={s.image} className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
                <div className="flex gap-4 p-5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-interactive text-sm font-bold text-on-accent" aria-hidden>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-text">
                      <span className="sr-only">Step {i + 1}: </span>
                      {s.title}
                    </h2>
                    <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-text">{s.body}</p>
                    {s.command && <Command text={s.command} />}
                    {s.tip && (
                      <p className="mt-2 flex items-start gap-1.5 text-xs text-text-muted">
                        <Lightbulb className="mt-px size-3.5 shrink-0" aria-hidden />
                        {s.tip}
                      </p>
                    )}
                  </div>
                </div>
                <figure className="border-t border-border bg-surface-muted p-3 sm:p-4">
                  {hasImage(platform, s.image) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt={s.shows} loading={i < 2 ? 'eager' : 'lazy'} className="mx-auto block h-auto max-h-[480px] w-auto max-w-full rounded-md border border-border bg-surface" />
                  ) : (
                    <div role="img" aria-label={`Screenshot to come: ${s.shows}`} className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-border px-6 text-center text-text-muted sm:h-48">
                      <ImageIcon className="size-6" aria-hidden />
                      <span className="max-w-[48ch] text-xs">{s.shows}</span>
                    </div>
                  )}
                </figure>
              </li>
            );
          })}
        </ol>

        <section aria-labelledby="update-title" className="rounded-lg border border-border bg-surface p-5">
          <h2 id="update-title" className="text-base font-semibold text-text">
            {g.update.title}
          </h2>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-text">
            {g.update.steps.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>

        {g.extra && (
          <section aria-labelledby="extra-title" className="rounded-lg border border-border bg-surface p-5">
            <h2 id="extra-title" className="text-base font-semibold text-text">
              {g.extra.title}
            </h2>
            <p className="mt-1 text-sm text-text-muted">{g.extra.intro}</p>
            <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-text">
              {g.extra.steps.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ol>
            <Command text={g.extra.commands.join('\n')} />
          </section>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-sm text-text-muted">
          <span>Stuck? Ask the administrator who invited you.</span>
          <span className="flex flex-wrap gap-4">
            {other.map((p) => (
              <Link key={p} href={`/download/guide/${p}`} className="font-medium text-interactive hover:underline">
                {GUIDES[p].name} guide
              </Link>
            ))}
            <Link href="/download" className="font-medium text-interactive hover:underline">
              Download page
            </Link>
          </span>
        </footer>
      </div>
    </main>
  );
}

/** A terminal command, selectable as one block. */
function Command({ text }: { text: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-md bg-[#0b1220] px-3 py-2 text-[13px] leading-relaxed text-[#e6edf7]">
      <code>{text}</code>
    </pre>
  );
}
