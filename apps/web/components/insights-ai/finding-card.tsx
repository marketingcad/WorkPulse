'use client';
import { Suspense, lazy, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Info, Sparkles, TriangleAlert } from 'lucide-react';
import type { InsightFindingDto } from '@tallywork/contracts/assistant';
import { resolveNav } from '@tallywork/domain/assistant';
import { Badge, Button, cx } from '@tallywork/ui';
import { t } from '@/lib/i18n';
import { useOrg } from '@/lib/org';
import { askAssistant } from '@/lib/assistant-bridge';
import './messages';

// Opened from the missing-timesheets finding only: loaded on demand.
const ReminderDraftDialog = lazy(() => import('./reminder-draft-dialog'));

const SEVERITY = {
  warning: { tone: 'danger', icon: TriangleAlert },
  attention: { tone: 'warning', icon: AlertTriangle },
  info: { tone: 'info', icon: Info },
} as const;
const BASIS_TONE = { fact: 'neutral', observation: 'secondary', estimate: 'brand' } as const;

const fmt = (unit: InsightFindingDto['metrics'][number]['unit'], value: number) => t(`aiInsights.unit.${unit}`, { value: value.toLocaleString() });

/** One finding: what was found, on what basis, the measures behind it, and where to act. */
export function FindingCard({ finding: f }: { finding: InsightFindingDto }) {
  const org = useOrg();
  const sev = SEVERITY[f.severity];
  const [drafting, setDrafting] = useState(false);
  const links = f.links.map((k) => resolveNav(org.grants, org.organization.id, k)).filter((l): l is NonNullable<typeof l> => !!l);
  return (
    <article data-testid="insight-card" data-category={f.category} data-basis={f.basis} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm">
      <header className="flex flex-wrap items-center gap-2">
        <Badge tone={sev.tone} icon={<sev.icon className="size-3" aria-hidden />}>
          {t(`aiInsights.severity.${f.severity}`)}
        </Badge>
        <Badge tone={BASIS_TONE[f.basis]}>{t(`aiInsights.basis.${f.basis}`)}</Badge>
        <span className="ml-auto text-2xs text-text-faint tabular">
          {f.period.from} – {f.period.to}
        </span>
      </header>
      <div>
        <h3 className="text-sm font-semibold">{f.title}</h3>
        <p className="mt-1 text-sm text-text-muted">{f.summary}</p>
      </div>
      {f.metrics.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {f.metrics.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="truncate text-2xs uppercase tracking-wide text-text-faint">{m.label}</dt>
              <dd className="tabular text-sm font-semibold">
                {fmt(m.unit, m.value)}
                {m.previous !== undefined && m.previous !== null && <span className="ml-1 text-xs font-normal text-text-muted">({t('aiInsights.previous', { value: fmt(m.unit, m.previous) })})</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-xs">
        <span className="font-medium">{t('aiInsights.nextStep')}:</span> <span className="text-text-muted">{f.next_step}</span>
      </p>
      {(links.length > 0 || org.assistant_enabled) && (
        <footer className={cx('flex flex-wrap items-center gap-2 border-t border-border pt-3')}>
          {links.map((l) => (
            <Link key={l.key} href={l.href} className="text-xs font-medium text-interactive hover:underline">
              {l.label}
            </Link>
          ))}
          {org.assistant_enabled && f.category === 'missing' && (
            <Button size="xs" variant="ghost" onClick={() => setDrafting(true)}>
              {t('aiInsights.draftReminder')}
            </Button>
          )}
          {org.assistant_enabled && (
            <Button size="xs" variant="ghost" className="ml-auto" icon={<Sparkles className="size-3" aria-hidden />} onClick={() => askAssistant(t('aiInsights.askQuestion', { title: f.title, from: f.period.from, to: f.period.to }))}>
              {t('aiInsights.ask')}
            </Button>
          )}
        </footer>
      )}
      {drafting && (
        <Suspense fallback={null}>
          <ReminderDraftDialog period={f.period} onClose={() => setDrafting(false)} />
        </Suspense>
      )}
    </article>
  );
}
