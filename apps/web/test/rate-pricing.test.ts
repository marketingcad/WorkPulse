import { describe, expect, it } from 'vitest';
import { previewRatesFromBody } from '../components/finance/rate-pricing';

/**
 * QA audit, 11 Nov 2026 (BUG-08): a form that saves rates first asks what they would price of the
 * approved time with no rate. These are the rates it asks about.
 */
const project = { scope: 'PROJECT' as const, scopeId: 'p1' };

describe('previewRatesFromBody', () => {
  it('lists the pay and bill rates in the body, from the chosen day', () => {
    expect(previewRatesFromBody({ name: 'Site', pay_rate_minor: 2500, bill_rate_minor: 10000, rate_effective_from: '2026-11-01' }, project, 'USD', '2026-11-12')).toEqual([
      { kind: 'PAY', scope: 'PROJECT', scope_id: 'p1', amount_minor: 2500, currency: 'USD', effective_from: '2026-11-01' },
      { kind: 'BILL', scope: 'PROJECT', scope_id: 'p1', amount_minor: 10000, currency: 'USD', effective_from: '2026-11-01' },
    ]);
  });

  it('without a date the rates start today, as the server applies them', () => {
    expect(previewRatesFromBody({ bill_rate_minor: 9000 }, { scope: 'CLIENT', scopeId: 'c1' }, 'EUR', '2026-11-12')).toEqual([{ kind: 'BILL', scope: 'CLIENT', scope_id: 'c1', amount_minor: 9000, currency: 'EUR', effective_from: '2026-11-12' }]);
  });

  it('leaves out cleared and untouched rates', () => {
    expect(previewRatesFromBody({ pay_rate_minor: null, name: 'x' }, project, 'USD', '2026-11-12')).toEqual([]);
  });

  it('asks nothing for a record that does not exist yet (it has no approved time)', () => {
    expect(previewRatesFromBody({ pay_rate_minor: 2500 }, { scope: 'PROJECT', scopeId: null }, 'USD', '2026-11-12')).toEqual([]);
  });
});
