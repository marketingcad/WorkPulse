'use client';
import { BriefcaseBusiness, CalendarRange, Clock3, HandCoins, Users } from 'lucide-react';
import type { PortalScreenshotDto, PortalSummaryDto } from '@tallywork/contracts';
import { ActivityBar, BrandLockup, KpiStrip, Panel, PersonCell, Spinner, StatusBadge, type Kpi } from '@tallywork/ui';
import { t } from '@/lib/i18n';

const hours = (s: number) => `${(s / 3600).toFixed(1)} h`;

/** A thin progress bar; budgets over 80% turn amber, over 100% red, otherwise the brand gradient. */
function Bar({ pct, label }: { pct: number; label: string }) {
  const tone = pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warning' : 'bg-gradient-to-r from-[#3b5bff] to-[#7c5cff]';
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

const dateField = 'h-9 rounded-sm border border-white/15 bg-white/10 px-2.5 text-sm text-white [color-scheme:dark] focus:border-[#6ea2ff] focus:outline-none focus:ring-2 focus:ring-[#3b82ff]/40';

export function PortalDashboard({
  summary: s,
  screenshots,
  screenshotsLoading,
  range,
  onRange,
  embedded = false,
}: {
  summary: PortalSummaryDto;
  screenshots: PortalScreenshotDto[] | null;
  /** True while the screenshots request for the current range is still in flight; shows a spinner instead of an empty grid. Optional so existing callers (e.g. the admin preview) keep working unchanged. */
  screenshotsLoading?: boolean;
  range: { from: string; to: string };
  onRange: (r: { from: string; to: string }) => void;
  /** Shown inside another page (the admin preview), which has its own top-level heading. */
  embedded?: boolean;
}) {
  const Title = embedded ? 'h2' : 'h1';
  const total = s.totals.tracked_seconds + s.totals.manual_seconds;
  const kpis: Kpi[] = [
    { label: t('portal.dash.total'), value: hours(total), icon: <Clock3 />, tone: 'blue' },
    { label: t('portal.dash.billable'), value: hours(s.totals.billable_seconds), icon: <HandCoins />, tone: 'green' },
    { label: t('portal.dash.projects'), value: s.projects.length, icon: <BriefcaseBusiness />, tone: 'violet' },
    ...(s.workers ? [{ label: t('portal.dash.people'), value: s.workers.length, icon: <Users />, tone: 'teal' as const }] : []),
  ];
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6">
      {/* Brand band, as on the sign-in page. */}
      <header className="relative overflow-hidden rounded-xl bg-[#060d22] px-6 py-6 text-white shadow-card sm:px-8 sm:py-7">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_90%_at_100%_100%,rgba(37,84,255,0.5),transparent_70%),radial-gradient(40%_70%_at_0%_0%,rgba(91,61,245,0.25),transparent_70%)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <BrandLockup size={30} tone="onDark" />
            <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-[#9fb0cf]">{t('portal.dash.eyebrow')}</p>
            <Title className="mt-1 truncate text-3xl font-extrabold tracking-tight">{s.client.name}</Title>
            <p className="mt-1 text-sm text-[#c7d2e8]">{s.organization.name}</p>
          </div>
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">{t('portal.dash.range')}</legend>
            <CalendarRange className="size-4 text-[#9fb0cf]" aria-hidden />
            <span className="text-sm font-medium text-[#c7d2e8]" aria-hidden>
              {t('portal.dash.range')}
            </span>
            <input type="date" aria-label={t('portal.dash.from')} value={range.from} max={range.to} onChange={(e) => onRange({ ...range, from: e.target.value })} className={dateField} />
            <span className="text-[#9fb0cf]" aria-hidden>
              –
            </span>
            <input type="date" aria-label={t('portal.dash.to')} value={range.to} min={range.from} onChange={(e) => onRange({ ...range, to: e.target.value })} className={dateField} />
          </fieldset>
        </div>
      </header>

      <KpiStrip items={kpis} />

      <Panel title={t('portal.dash.projects')}>
        <ul className="divide-y divide-border">
          {s.projects.map((p) => (
            <li key={p.id} className="px-5 py-3.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2.5 font-medium">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
                  <span className="truncate">{p.name}</span>
                </span>
                <span className="tabular shrink-0 font-semibold">{hours(p.tracked_seconds)}</span>
              </div>
              {p.budget && (
                <div className="mt-2">
                  <Bar pct={p.budget.pct_used} label={t('portal.dash.budgetLabel', { project: p.name })} />
                  <p className="mt-1 text-xs text-text-muted">{t('portal.dash.budget', { used: (p.budget.used_seconds / 3600).toFixed(1), amount: (p.budget.amount_seconds / 3600).toFixed(1), pct: p.budget.pct_used })}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      {s.workers && (
        <Panel title={t('portal.dash.workers')}>
          {s.workers.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-text-muted">{t('portal.dash.noTime')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/60">
                    <th scope="col" className="h-10 px-5 text-left text-2xs font-semibold uppercase tracking-wide text-text-muted">
                      {t('portal.dash.person')}
                    </th>
                    <th scope="col" className="h-10 px-3 text-right text-2xs font-semibold uppercase tracking-wide text-text-muted">
                      {t('portal.dash.hours')}
                    </th>
                    {s.sections.activity && (
                      <th scope="col" className="h-10 px-5 text-right text-2xs font-semibold uppercase tracking-wide text-text-muted">
                        {t('portal.dash.activity')}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {s.workers.map((w) => (
                    <tr key={w.membership_id} className="border-t border-border align-top first:border-t-0">
                      <td className="px-5 py-3">
                        <PersonCell name={w.name} sub={w.title ?? undefined} size={30} />
                        {w.tasks.length > 0 && (
                          <ul className="mt-2 flex flex-wrap gap-1.5 pl-9.5">
                            {w.tasks.slice(0, 5).map((k) => (
                              <li key={k.task_id ?? 'none'} className="rounded-full bg-surface-muted px-2 py-0.5 text-2xs text-text-muted">
                                {k.title} · <span className="tabular font-medium text-text">{hours(k.seconds)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="tabular px-3 py-3 text-right font-semibold">{hours(w.tracked_seconds + w.manual_seconds)}</td>
                      {s.sections.activity && (
                        <td className="px-5 py-3 text-right">
                          <ActivityBar pct={w.activity_pct} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {s.tasks && (
        <Panel title={t('portal.dash.tasks')}>
          <ul className="divide-y divide-border text-sm">
            {s.tasks.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{k.title}</span>
                    <StatusBadge status={k.status} label={t(`portal.status.${k.status}` as 'portal.status.TODO')} />
                  </span>
                  {(k.due_date || k.assignees.length > 0) && (
                    <span className="mt-0.5 block text-xs text-text-muted">
                      {k.due_date ?? ''}
                      {k.due_date && k.assignees.length ? ' · ' : ''}
                      {k.assignees.join(', ')}
                    </span>
                  )}
                </span>
                <span className="flex w-full items-center gap-3 sm:w-56">
                  {k.estimate_seconds ? (
                    <>
                      <span className="flex-1">
                        <Bar pct={(k.tracked_seconds / k.estimate_seconds) * 100} label={t('portal.dash.estimate', { tracked: hours(k.tracked_seconds), estimate: hours(k.estimate_seconds) })} />
                      </span>
                      <span className="tabular shrink-0 text-xs text-text-muted">{t('portal.dash.estimate', { tracked: hours(k.tracked_seconds), estimate: hours(k.estimate_seconds) })}</span>
                    </>
                  ) : (
                    <span className="tabular ml-auto text-xs text-text-muted">{hours(k.tracked_seconds)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {screenshots && (
        <Panel title={t('portal.dash.screenshots')}>
          {screenshotsLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
              {screenshots.map((sh) => (
                <a key={sh.id} href={sh.full_url} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-sm border border-border bg-surface shadow-card transition-shadow hover:ring-2 hover:ring-interactive/40">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived media URLs */}
                  <img src={sh.thumb_url} alt={`${sh.worker_name}, ${new Date(sh.captured_at).toLocaleString()}`} className="aspect-video w-full bg-surface-muted object-cover transition-opacity group-hover:opacity-90" loading="lazy" />
                  <span className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-text-muted">
                    <span className="truncate font-medium text-text">{sh.worker_name}</span>
                    <span className="tabular shrink-0">{new Date(sh.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
