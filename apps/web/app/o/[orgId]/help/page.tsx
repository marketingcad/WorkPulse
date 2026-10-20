'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, ChevronRight, Compass, LifeBuoy, PlayCircle, Search, X } from 'lucide-react';
import { Button, EmptyState, Input, PageHeader, cx } from '@tallywork/ui';
import { useOrg } from '@/lib/org';
import { t } from '@/lib/i18n';
import { activeNav, filterNav, type NavItem } from '@/components/shell/nav';
import { HELP_ARTICLES, HELP_CATEGORIES, NAV_GUIDE, type HelpArticle, type HelpCategoryId } from '@/components/help/content';
import { searchArticles } from '@/components/help/search';
import { rememberHelpArticle } from '@/components/help/help-return';

/**
 * Help Center: a plain-language manual for admins and managers, with search, step-by-step guides
 * that link straight to the right page, answers to common questions, and the product tour.
 * Only guides and links for pages this person can open are shown.
 */
export default function HelpPage() {
  const org = useOrg();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const nav = useMemo(() => filterNav(org.can, org.grants, org.isManagerView), [org]);
  const canOpen = (href: string) => href === '' || href.startsWith('/me/') || href === '/timesheets' || href === '/pay-stubs' || activeNav(nav, href.split(/[?#]/)[0]!) !== null;

  // Guides for pages this person can use; a guide without any usable page is about general use.
  const articles = useMemo(
    () =>
      HELP_ARTICLES.filter((a) => (!a.perms || a.perms.some((p) => org.can(p))) && (!a.links?.length || a.links.some((l) => canOpen(l.href)))).map((a) => ({
        ...a,
        body: [...(a.steps ?? []), ...(a.points ?? []), a.tip ?? ''],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [org, nav],
  );
  const results = useMemo(() => (query.trim() ? searchArticles(articles, query) : null), [articles, query]);

  // Opened from a link like /help#approve-timesheets: open that guide and scroll to it.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    setOpen((o) => new Set(o).add(id));
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 50);
  }, []);

  const toggle = (id: string) => setOpen((o) => (o.has(id) ? (o.delete(id), new Set(o)) : new Set(o).add(id)));
  const restartTour = () => router.push(`${org.base}?tour=1`);
  const guide = nav.flatMap((g) => g.items).filter((i) => NAV_GUIDE[i.label]);

  return (
    <>
      <PageHeader
        title="Help Center"
        description="How to use WorkPulse, step by step, in plain language."
        actions={
          <>
            <Button icon={<ArrowLeft className="size-3.5" />} onClick={() => (window.history.length > 1 ? router.back() : router.push(org.base))}>
              Back
            </Button>
            <Button variant="primary" icon={<PlayCircle className="size-3.5" />} onClick={restartTour}>
              Start the tour
            </Button>
          </>
        }
      />

      <div className="relative mb-6 max-w-2xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-faint" aria-hidden />
        <Input
          type="search"
          aria-label="Search help"
          placeholder="Search help, e.g. “approve timesheet”, “invoice”, “break”"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 pl-9 pr-9 text-base"
        />
        {query && (
          <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-text-muted hover:text-text" aria-label="Clear search">
            <X className="size-4" />
          </button>
        )}
      </div>

      {results ? (
        <section aria-label="Search results" className="flex max-w-3xl flex-col gap-3">
          <p className="text-sm text-text-muted" role="status">
            {results.length ? `${results.length} ${results.length === 1 ? 'guide matches' : 'guides match'} “${query.trim()}”` : ''}
          </p>
          {results.length ? (
            results.map((a) => <Article key={a.id} a={a} open onToggle={() => undefined} canOpen={canOpen} />)
          ) : (
            <EmptyState
              title={`Nothing found for “${query.trim()}”`}
              description="Try a shorter or different word, like “timesheet”, “rate” or “device”, or browse the topics below."
              action={<Button onClick={() => setQuery('')}>Show all topics</Button>}
            />
          )}
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Help topics" className="lg:sticky lg:top-20 lg:self-start">
            <ul className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
              {HELP_CATEGORIES.map((c) => (
                <li key={c.id}>
                  <a href={`#topic-${c.id}`} className="block rounded-sm px-2.5 py-1.5 text-sm text-text-muted hover:bg-surface-muted hover:text-text">
                    {c.title}
                  </a>
                </li>
              ))}
              <li>
                <a href="#topic-pages" className="block rounded-sm px-2.5 py-1.5 text-sm text-text-muted hover:bg-surface-muted hover:text-text">
                  Finding your way
                </a>
              </li>
            </ul>
          </nav>

          <div className="flex min-w-0 max-w-3xl flex-col gap-10">
            {HELP_CATEGORIES.map((c) => {
              const list = articles.filter((a) => a.category === c.id);
              if (!list.length) return null;
              return (
                <section key={c.id} id={`topic-${c.id}`} aria-labelledby={`topic-${c.id}-title`} className="scroll-mt-20">
                  <h2 id={`topic-${c.id}-title`} className="text-lg font-semibold">
                    {c.title}
                  </h2>
                  <p className="mb-3 text-sm text-text-muted">{c.description}</p>
                  <div className="flex flex-col gap-2">
                    {list.map((a) => (
                      <Article key={a.id} a={a} open={open.has(a.id)} onToggle={() => toggle(a.id)} canOpen={canOpen} />
                    ))}
                  </div>
                </section>
              );
            })}

            <section id="topic-pages" aria-labelledby="topic-pages-title" className="scroll-mt-20">
              <h2 id="topic-pages-title" className="flex items-center gap-2 text-lg font-semibold">
                <Compass className="size-4 text-text-muted" aria-hidden /> Finding your way
              </h2>
              <p className="mb-3 text-sm text-text-muted">Every item in your menu and what it is for. Your menu only shows what your role can open.</p>
              <ul className="divide-y divide-border rounded-md border border-border bg-surface">
                {guide.map((i: NavItem) => (
                  <li key={i.label} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <i.icon className="size-4 shrink-0 text-text-muted" aria-hidden />
                        {t(i.label)}
                        {i.tabs && i.tabs.length > 1 && <span className="text-2xs font-normal text-text-faint">{i.tabs.map((tab) => t(tab.label)).join(' · ')}</span>}
                      </div>
                      <p className="mt-0.5 text-sm text-text-muted">{NAV_GUIDE[i.label]}</p>
                    </div>
                    <Link href={`${org.base}${i.href}`} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-interactive hover:underline">
                      Open <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className="flex flex-col gap-3 rounded-md border border-border bg-surface-muted px-4 py-4 sm:flex-row sm:items-center">
              <LifeBuoy className="size-5 shrink-0 text-interactive" aria-hidden />
              <p className="text-sm text-text-muted">
                Still stuck? Ask your WorkPulse administrator: they can check your role, your devices and your organization’s settings. Members who track time use the desktop app; this site is for admins and managers.
              </p>
            </section>
          </div>
        </div>
      )}
    </>
  );
}

function Article({ a, open, onToggle, canOpen }: { a: HelpArticle & { body: string[] }; open: boolean; onToggle: () => void; canOpen: (href: string) => boolean }) {
  const org = useOrg();
  const links = (a.links ?? []).filter((l) => canOpen(l.href));
  return (
    <article id={a.id} className="scroll-mt-20 rounded-md border border-border bg-surface">
      <h3>
        <button onClick={onToggle} aria-expanded={open} aria-controls={`${a.id}-body`} className="flex w-full items-start gap-3 rounded-md px-4 py-3 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-interactive">
          <ChevronRight className={cx('mt-0.5 size-4 shrink-0 text-text-faint transition-transform motion-reduce:transition-none', open && 'rotate-90')} aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{a.title}</span>
            <span className="block text-sm text-text-muted">{a.summary}</span>
          </span>
        </button>
      </h3>
      {open && (
        <div id={`${a.id}-body`} className="flex flex-col gap-3 border-t border-border px-4 py-3 pl-11 text-sm">
          {a.steps && (
            <ol className="flex list-decimal flex-col gap-1.5 pl-4 marker:text-text-faint">
              {a.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          {a.points && (
            <ul className="flex list-disc flex-col gap-1.5 pl-4 marker:text-text-faint">
              {a.points.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
          {a.tip && <p className="rounded-sm bg-interactive-soft px-3 py-2 text-text">Tip: {a.tip}</p>}
          {links.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {links.map((l) => (
                <Link
                  key={l.href + l.label}
                  href={`${org.base}${l.href}`}
                  onClick={() => rememberHelpArticle({ id: a.id, title: a.title })}
                  className="inline-flex items-center gap-1 rounded-sm border border-border px-2.5 py-1 text-sm font-medium text-interactive hover:bg-surface-muted"
                >
                  {l.label} <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
