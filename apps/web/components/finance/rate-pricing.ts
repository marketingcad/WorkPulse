/**
 * Which rates a form's request body is about to save, as the pricing preview takes them
 * (POST /rates/pricing-preview). Pure, so it is unit-tested (test/rate-pricing.test.ts).
 * QA audit 11 Nov 2026 (BUG-08): saving a rate prices approved time that had no rate, so the form
 * asks first, showing how much.
 */
export type RateTarget = { scope: 'ORG' | 'CLIENT' | 'PROJECT' | 'WORKER' | 'PROJECT_WORKER'; scopeId: string | null };

export interface PreviewRate {
  kind: 'PAY' | 'BILL';
  scope: RateTarget['scope'];
  scope_id: string | null;
  amount_minor: number;
  currency: string;
  effective_from: string;
}

/**
 * The rates in a member, client or project request body. A cleared rate (null) prices nothing and is
 * left out; without `rate_effective_from` the rates start today, as the server applies them for an
 * existing record. A record that does not exist yet has no approved time, so nothing is previewed.
 */
export function previewRatesFromBody(body: Record<string, unknown>, target: RateTarget, currency: string, today: string): PreviewRate[] {
  if (target.scope !== 'ORG' && !target.scopeId) return [];
  const from = typeof body.rate_effective_from === 'string' && body.rate_effective_from ? body.rate_effective_from : today;
  const out: PreviewRate[] = [];
  for (const [kind, field] of [
    ['PAY', 'pay_rate_minor'],
    ['BILL', 'bill_rate_minor'],
  ] as const) {
    const amount = body[field];
    if (typeof amount === 'number') out.push({ kind, scope: target.scope, scope_id: target.scopeId, amount_minor: amount, currency, effective_from: from });
  }
  return out;
}
