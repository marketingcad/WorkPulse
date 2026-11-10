import { describe, expect, it } from 'vitest';
import { financeFindings } from '../src/insights';

const period = { from: '2026-10-01', to: '2026-10-31' };
const previous = { from: '2026-09-01', to: '2026-09-30' };
const run = (id: string, periodStart: string, currency: string, grossMinor: number, overtimeSeconds = 0, groupId = `g-${currency}`, groupName = 'Staff') => ({ id, periodStart, periodEnd: periodStart, status: 'FINALIZED', currency, grossMinor, netMinor: grossMinor, overtimeSeconds, groupId, groupName });

describe('financeFindings', () => {
  it('compares payroll runs per currency and never adds currencies together', () => {
    const { findings } = financeFindings({
      period,
      previous,
      payroll: [run('a', '2026-10-01', 'USD', 120_000_00, 10 * 3600), run('b', '2026-09-01', 'USD', 100_000_00, 4 * 3600), run('c', '2026-10-01', 'EUR', 50_000_00), run('d', '2026-09-01', 'EUR', 50_000_00)],
      owedEstimate: null,
      billing: null,
    });
    const changes = findings.filter((f) => f.category === 'payroll_change');
    expect(changes.map((f) => f.metrics[0]!.currency).sort()).toEqual(['EUR', 'USD']);
    const usd = changes.find((f) => f.metrics[0]!.currency === 'USD')!;
    expect(usd.metrics).toContainEqual({ label: 'Gross pay', value: 120_000_00, unit: 'money', currency: 'USD', previous: 100_000_00 });
    expect(usd.metrics).toContainEqual({ label: 'Change', value: 20, unit: 'percent' });
    for (const f of findings) for (const m of f.metrics) if (m.unit === 'money') expect(m.currency).toMatch(/^[A-Z]{3}$/);
    expect(findings.find((f) => f.category === 'overtime_cost_share')!.metrics).toContainEqual({ label: 'Overtime hours', value: 10, unit: 'hours', previous: 4 });
  });

  it('compares runs within one pay group, never a weekly group with a monthly one in the same currency', () => {
    const { findings } = financeFindings({
      period,
      previous,
      payroll: [
        run('w2', '2026-10-08', 'USD', 10_000_00, 0, 'weekly', 'Weekly staff'),
        run('w1', '2026-10-01', 'USD', 10_000_00, 0, 'weekly', 'Weekly staff'),
        run('m2', '2026-10-01', 'USD', 40_000_00, 0, 'monthly', 'Monthly contractors'),
        run('m1', '2026-09-01', 'USD', 40_000_00, 0, 'monthly', 'Monthly contractors'),
      ],
      owedEstimate: null,
      billing: null,
    });
    const changes = findings.filter((f) => f.category === 'payroll_change');
    expect(changes.map((f) => f.title).sort()).toEqual(['Payroll – Monthly contractors (USD) up 0 %', 'Payroll – Weekly staff (USD) up 0 %']);
    expect(new Set(changes.map((f) => f.id)).size).toBe(2);
    for (const f of changes) expect(f.severity).toBe('info');
  });

  it('labels the payroll forecast as an estimate, from existing pricing', () => {
    const { findings } = financeFindings({ period, previous, payroll: [], owedEstimate: [{ currency: 'USD', approvedMinor: 40_000_00, estimatedMinor: 15_000_00 }], billing: null });
    const f = findings.find((x) => x.category === 'payroll_forecast')!;
    expect(f.basis).toBe('estimate');
    expect(f.summary.startsWith('Estimated from approved time at its approved price')).toBe(true);
    expect(f.metrics).toContainEqual({ label: 'Expected pay', value: 55_000_00, unit: 'money', currency: 'USD' });
  });

  it('flags overdue invoices and compares collections', () => {
    const { findings } = financeFindings({ period, previous, payroll: null, owedEstimate: null, billing: { currency: 'USD', outstandingMinor: 9_000_00, overdueMinor: 3_000_00, overdueCount: 2, collectedMinor: 12_000_00, previousCollectedMinor: 10_000_00 } });
    expect(findings.find((f) => f.category === 'overdue_invoices')).toMatchObject({ severity: 'warning', basis: 'fact' });
    expect(findings.find((f) => f.category === 'collections_change')!.metrics).toContainEqual({ label: 'Change', value: 20, unit: 'percent' });
  });

  it('says what it cannot see instead of guessing', () => {
    const r = financeFindings({ period, previous, payroll: null, owedEstimate: null, billing: null });
    expect(r.findings).toEqual([]);
    expect(r.limitations).toEqual(['Payroll insights need payroll access.', 'The payroll forecast needs billing or rates access.', 'Invoice and payment insights need invoice or payment access.']);
  });
});
