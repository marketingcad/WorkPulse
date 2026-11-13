'use client';
import { useState, type ReactNode } from 'react';
import type { RatePricingPreviewDto } from '@tallywork/contracts';
import { ConfirmDialog, fmtMoney } from '@tallywork/ui';
import { api } from '@/lib/api';
import { useOrg } from '@/lib/org';
import type { PreviewRate } from './rate-pricing';

/**
 * Before rates are saved: if they would price approved time that had no rate (QA audit BUG-08), say
 * how much and ask. `confirm(rates)` resolves true when there is nothing to price or the person agrees,
 * false when they cancel; render `dialog` once in the form. Nothing is asked in the usual case.
 */
export function useRatePricingConfirm(): { confirm: (rates: PreviewRate[]) => Promise<boolean>; dialog: ReactNode } {
  const org = useOrg();
  const [pending, setPending] = useState<{ preview: RatePricingPreviewDto; resolve: (ok: boolean) => void } | null>(null);

  const confirm = async (rates: PreviewRate[]) => {
    if (!rates.length) return true;
    const preview = await api<RatePricingPreviewDto>(`/orgs/${org.organization.id}/rates/pricing-preview`, { method: 'POST', body: { rates } });
    if (!preview.entries) return true;
    return new Promise<boolean>((resolve) => setPending({ preview, resolve }));
  };

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const p = pending?.preview;
  const parts = p
    ? [
        p.pay_seconds ? `${org.fmtDuration(p.pay_seconds)} of pay (${fmtMoney(p.pay_minor, p.currency)})` : null,
        p.bill_seconds ? `${org.fmtDuration(p.bill_seconds)} of billable time (${fmtMoney(p.bill_minor, p.currency)})` : null,
      ].filter(Boolean)
    : [];

  const dialog = p ? (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && close(false)}
      title="Price approved time?"
      description={`These rates also price approved time that had no rate: ${parts.join(' and ')}. Approved time that already had a rate, or is on an invoice or a finalized payroll, keeps its amounts.`}
      confirmLabel="Save and price"
      onConfirm={() => close(true)}
    />
  ) : null;

  return { confirm, dialog };
}
