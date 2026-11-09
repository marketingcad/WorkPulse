import { describe, expect, it } from 'vitest';
import { explainScore, type ScoreSnapshot } from '../src/insights';

const period = { from: '2026-10-01', to: '2026-10-31' };
const previous = { from: '2026-09-01', to: '2026-09-30' };
const subject = { type: 'member' as const, id: 'm1', name: 'Ana' };
const part = (value: number | null, effective_weight = 0.2) => ({ value, weight: 20, effective_weight });
const snap = (score: number | null, goals: number | null, delivery = 60, quality = 70): ScoreSnapshot => ({
  score,
  coverage: score === null ? 30 : 90,
  parts: { goals: part(goals, 0.3), delivery: part(delivery, 0.25), consistency: part(80, 0.2), quality: part(quality, 0.15), attendance: part(90, 0.1) },
});

describe('explainScore', () => {
  it('reports the change and names the parts that drove it', () => {
    const { findings } = explainScore({ subject, period, previous, current: snap(70, 80), before: snap(62, 40) });
    const change = findings.find((f) => f.category === 'score_change')!;
    expect(change.basis).toBe('observation');
    expect(change.metrics).toContainEqual({ label: 'Score', value: 70, unit: 'count', previous: 62 });
    expect(change.metrics).toContainEqual({ label: 'Change (points)', value: 8, unit: 'count' });
    const drivers = findings.find((f) => f.category === 'drivers')!;
    expect(drivers.summary.startsWith('Goal completion')).toBe(true);
  });
  it('suggests one development step for the lowest measured part, with fixed wording', () => {
    const { findings } = explainScore({ subject, period, previous, current: snap(70, 80, 30), before: null });
    const dev = findings.find((f) => f.category === 'development')!;
    expect(dev.basis).toBe('fact');
    expect(dev.next_step).toBe('Review task estimates and due dates together.');
  });
  it('never invents a score or a change', () => {
    const none = explainScore({ subject, period, previous, current: snap(null, null), before: snap(60, 50) });
    expect(none.limitations).toContain('Not enough measured this period to give a score.');
    expect(none.findings.some((f) => f.category === 'score_change')).toBe(false);
    const first = explainScore({ subject, period, previous, current: snap(70, 80), before: null });
    expect(first.limitations).toContain('No earlier score to compare with.');
    expect(first.findings.some((f) => f.category === 'score_change' || f.category === 'drivers')).toBe(false);
  });
});
