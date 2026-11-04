'use client';
import { useState } from 'react';
import { ArrowRight, Film, RefreshCw } from 'lucide-react';
import type { HelpTutorialDto } from '@tallywork/contracts';
import { Button, cx } from '@tallywork/ui';
import { useOrgId, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';

/** The published video tutorial, for people who may change the organization (system admins); null when none is published. */
export function useHelpTutorial() {
  const org = useOrg();
  return useOrgQuery<HelpTutorialDto | null>(org.can('org:update') ? '/help/tutorial' : null, { staleTime: 10 * 60_000 });
}

const minutes = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} min`;

/**
 * The WorkPulse video tutorial in the Help Center, one video per chapter: choosing a chapter plays it,
 * and the next chapter starts when one ends. Shown only to system admins, and only once a tutorial
 * has been published (`pnpm tutorial:publish`).
 */
export function VideoTutorial() {
  const orgId = useOrgId();
  const q = useHelpTutorial();
  const [current, setCurrent] = useState(0);
  // Only a viewer's choice (a chapter, or the end of the previous one) starts playback.
  const [autoPlay, setAutoPlay] = useState(false);

  if (q.isError)
    return (
      <Section>
        <div role="alert" className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-4 text-sm sm:flex-row sm:items-center">
          <p className="flex-1 text-text-muted">The video tutorial could not be loaded. Check your connection and try again.</p>
          <Button icon={<RefreshCw className="size-3.5" />} loading={q.isFetching} onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      </Section>
    );
  if (!q.data) return null;

  const { chapters } = q.data;
  const chapter = chapters[Math.min(current, chapters.length - 1)]!;
  const file = (name: string) => `/api/v1/orgs/${orgId}/help/tutorial/files/${encodeURIComponent(name)}`;
  const play = (i: number) => {
    setAutoPlay(true);
    setCurrent(i);
  };
  const total = chapters.reduce((s, c) => s + c.seconds, 0);

  return (
    <Section description={`A ${minutes(total)} walkthrough of WorkPulse with demo data, from setting up your organization to payroll and reports. Watch from the start or pick a chapter.`}>
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        {/* A new element per chapter, so its captions and poster change with it. */}
        <video
          key={chapter.video}
          controls
          playsInline
          preload="metadata"
          autoPlay={autoPlay}
          src={file(chapter.video)}
          poster={chapter.poster ? file(chapter.poster) : undefined}
          onEnded={() => current < chapters.length - 1 && play(current + 1)}
          aria-label={`Video tutorial, chapter ${chapter.n}: ${chapter.title}`}
          className="aspect-video w-full bg-black"
        >
          {chapter.captions && <track kind="captions" srcLang="en" label="English" src={file(chapter.captions)} />}
        </video>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-2.5 text-sm">
          <p className="min-w-0 flex-1" aria-live="polite">
            <span className="text-text-muted">
              Chapter {chapter.n} of {chapters.length}
            </span>{' '}
            · <span className="font-medium">{chapter.title}</span>
          </p>
          {current < chapters.length - 1 && (
            <Button size="xs" variant="ghost" icon={<ArrowRight className="size-3.5" />} onClick={() => play(current + 1)}>
              Next chapter
            </Button>
          )}
        </div>
      </div>
      <ol aria-label="Chapters" className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {chapters.map((c, i) => (
          <li key={c.video}>
            <button
              onClick={() => play(i)}
              aria-current={i === current ? 'true' : undefined}
              className={cx(
                'flex w-full items-center gap-3 rounded-sm px-2.5 py-1.5 text-left text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-interactive',
                i === current ? 'bg-interactive-soft font-medium text-text' : 'text-text-muted',
              )}
            >
              <span className="tabular w-5 shrink-0 text-right text-text-faint">{c.n}</span>
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              <span className="tabular shrink-0 text-xs text-text-faint">{minutes(c.seconds)}</span>
            </button>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function Section({ description = 'A walkthrough of WorkPulse, from setting up your organization to payroll and reports.', children }: { description?: string; children: React.ReactNode }) {
  return (
    <section id="topic-video" aria-labelledby="topic-video-title" className="scroll-mt-20">
      <h2 id="topic-video-title" className="flex items-center gap-2 text-lg font-semibold">
        <Film className="size-4 text-text-muted" aria-hidden /> Video tutorial
      </h2>
      <p className="mb-3 text-sm text-text-muted">{description}</p>
      {children}
    </section>
  );
}
