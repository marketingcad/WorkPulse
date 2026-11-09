'use client';
import { Info } from 'lucide-react';
import type { InsightResultDto } from '@tallywork/contracts/assistant';
import { EmptyState, ErrorState, SegmentedControl, SkeletonRows, Tabs } from '@tallywork/ui';
import { useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { t } from '@/lib/i18n';
import { rangeFor } from '@/components/reports/date-range';
import { useUrlParams } from '@/components/timesheets/use-url-params';
import { FindingCard } from './finding-card';
import './messages';

const TABS = ['overview', 'workforce', 'timesheets', 'projects', 'workflow', 'capacity', 'finance'] as const;
const FINANCE_PERMS = ['payroll:read', 'invoices:read', 'payments:read', 'billing:read', 'rates:read'] as const;
type Tab = (typeof TABS)[number];
const PERIODS = ['this_week', 'last_week', 'this_month', 'last_month'] as const;
type PeriodKey = (typeof PERIODS)[number];

/**
 * AI Insights body (loaded on demand by the page). Findings are computed by the API from what the
 * person may see; this only shows them. Works without an AI key; "Ask WorkPulse AI" appears when
 * the assistant is on.
 */
export default function InsightsView() {
  const org = useOrg();
  const [url, setUrl] = useUrlParams(['tab', 'period'] as const);
  // The Finance tab exists only for finance roles (the API refuses everyone else anyway).
  const tabs = TABS.filter((v) => v !== 'finance' || FINANCE_PERMS.some((p) => org.can(p)));
  const tab: Tab = (tabs as readonly string[]).includes(url.tab ?? '') ? (url.tab as Tab) : 'overview';
  const period: PeriodKey = (PERIODS as readonly string[]).includes(url.period ?? '') ? (url.period as PeriodKey) : 'this_week';
  const range = rangeFor(period, org.membership.timezone || org.organization.timezone, org.organization.week_start);
  const q = useOrgQuery<InsightResultDto>(`/assistant/insights/${tab}?from=${range.from}&to=${range.to}`);

  return (
    <div className="flex flex-col gap-4">
      <p className="-mt-2 text-sm text-text-muted">{t('aiInsights.description')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label={t('aiInsights.period')}
          value={period}
          onChange={(v) => setUrl({ period: v })}
          options={PERIODS.map((p) => ({ value: p, label: t(`aiInsights.period.${p}`) }))}
        />
        {q.data && (
          <span className="text-xs text-text-muted tabular">
            {range.from} – {range.to} · {t('aiInsights.comparedWith', { from: q.data.previous.from, to: q.data.previous.to })}
          </span>
        )}
      </div>
      <Tabs value={tab} onValueChange={(v) => setUrl({ tab: v })} items={tabs.map((v) => ({ value: v, label: t(`aiInsights.tab.${v}`) }))} />

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading || !q.data ? (
        <SkeletonRows rows={4} cols={2} />
      ) : (
        <>
          {q.data.limitations.length > 0 && (
            <div role="note" className="flex items-start gap-2.5 rounded-md border border-info/30 bg-info-soft px-4 py-3 text-sm text-info">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <p className="font-medium">{t('aiInsights.limitations')}</p>
                <ul className="mt-1 list-disc pl-5">
                  {q.data.limitations.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {q.data.findings.length === 0 ? (
            <EmptyState title={t('aiInsights.emptyTitle')} description={t('aiInsights.emptyBody')} />
          ) : (
            <section aria-label={t('aiInsights.findingsLabel')} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {q.data.findings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
