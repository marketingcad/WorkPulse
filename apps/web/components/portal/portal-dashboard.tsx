'use client';
import type { PortalScreenshotDto, PortalSummaryDto } from '@tallywork/contracts';
import { BrandLockup } from '@tallywork/ui';
import { t } from '@/lib/i18n';

const hours = (s: number) => `${(s / 3600).toFixed(1)} h`;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function PortalDashboard({ summary: s, screenshots, range, onRange }: { summary: PortalSummaryDto; screenshots: PortalScreenshotDto[] | null; range: { from: string; to: string }; onRange: (r: { from: string; to: string }) => void }) {
  const total = s.totals.tracked_seconds + s.totals.manual_seconds;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <BrandLockup size={28} />
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">{s.client.name}</h1>
          <p className="text-sm text-text-muted">{s.organization.name}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          {t('portal.dash.range')}
          <input type="date" value={range.from} max={range.to} onChange={(e) => onRange({ ...range, from: e.target.value })} className="rounded-sm border border-border bg-surface px-2 py-1" />
          <input type="date" value={range.to} min={range.from} onChange={(e) => onRange({ ...range, to: e.target.value })} className="rounded-sm border border-border bg-surface px-2 py-1" />
        </label>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title={t('portal.dash.total')}>
          <p className="text-3xl font-semibold tabular">{hours(total)}</p>
          <p className="text-xs text-text-muted">
            {t('portal.dash.billable')}: {hours(s.totals.billable_seconds)}
          </p>
        </Card>
        <Card title={t('portal.dash.projects')}>
          <ul className="flex flex-col gap-2 text-sm">
            {s.projects.map((p) => (
              <li key={p.id}>
                <div className="flex justify-between">
                  <span className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: p.color }} aria-hidden />
                    {p.name}
                  </span>
                  <span className="tabular">{hours(p.tracked_seconds)}</span>
                </div>
                {p.budget && (
                  <>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={p.budget.pct_used} aria-valuemin={0} aria-valuemax={100}>
                      <div className={`h-full ${p.budget.pct_used >= 100 ? 'bg-danger' : p.budget.pct_used >= 80 ? 'bg-warning' : 'bg-interactive'}`} style={{ width: `${Math.min(100, p.budget.pct_used)}%` }} />
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">{t('portal.dash.budget', { used: (p.budget.used_seconds / 3600).toFixed(1), amount: (p.budget.amount_seconds / 3600).toFixed(1), pct: p.budget.pct_used })}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {s.workers && (
        <Card title={t('portal.dash.workers')}>
          {s.workers.length === 0 ? (
            <p className="text-sm text-text-muted">{t('portal.dash.noTime')}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {s.workers.map((w) => (
                  <tr key={w.membership_id} className="border-t border-border align-top first:border-t-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{w.name}</span>
                      {w.title && <span className="block text-xs text-text-muted">{w.title}</span>}
                      <ul className="mt-1 text-xs text-text-muted">
                        {w.tasks.slice(0, 5).map((k) => (
                          <li key={k.task_id ?? 'none'}>
                            {k.title}: {hours(k.seconds)}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="py-2 text-right tabular">{hours(w.tracked_seconds + w.manual_seconds)}</td>
                    {s.sections.activity && (
                      <td className="py-2 pl-3 text-right tabular" title={t('portal.dash.activity')}>
                        {w.activity_pct === null ? '—' : `${w.activity_pct}%`}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {s.tasks && (
        <Card title={t('portal.dash.tasks')}>
          <ul className="divide-y divide-border text-sm">
            {s.tasks.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{k.title}</span>
                  <span className="block text-xs text-text-muted">
                    {t(`portal.status.${k.status}` as 'portal.status.TODO')}
                    {k.due_date ? ` · ${k.due_date}` : ''}
                    {k.assignees.length ? ` · ${k.assignees.join(', ')}` : ''}
                  </span>
                </span>
                <span className="tabular text-xs text-text-muted">{k.estimate_seconds ? t('portal.dash.estimate', { tracked: hours(k.tracked_seconds), estimate: hours(k.estimate_seconds) }) : hours(k.tracked_seconds)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {screenshots && (
        <Card title={t('portal.dash.screenshots')}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {screenshots.map((sh) => (
              <a key={sh.id} href={sh.full_url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-sm border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived media URLs */}
                <img src={sh.thumb_url} alt={`${sh.worker_name}, ${new Date(sh.captured_at).toLocaleString()}`} className="aspect-video w-full object-cover" loading="lazy" />
                <span className="block px-2 py-1 text-xs text-text-muted">
                  {sh.worker_name}
                  {' · '}
                  {new Date(sh.captured_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
