import { describe, expect, it } from 'vitest';
import { capacityFindings } from '../src/insights';

const H = 3600;
const period = { from: '2026-11-10', to: '2026-11-23' };
const team = (name: string, t: Partial<{ scheduledSeconds: number | null; timeOffSeconds: number; recentWeeklySeconds: number | null; openEstimateSeconds: number }>) => ({
  id: name,
  name,
  scheduledSeconds: 80 * H,
  timeOffSeconds: 0,
  recentWeeklySeconds: 40 * H,
  openEstimateSeconds: 0,
  ...t,
});

describe('capacityFindings', () => {
  it('flags an overloaded team and an underused one, and suggests moving work as an estimate', () => {
    const { findings } = capacityFindings({ period, teams: [team('Design', { recentWeeklySeconds: 60 * H }), team('Ops', { recentWeeklySeconds: 10 * H })] });
    expect(findings.find((f) => f.category === 'overloaded')!.refs[0]!.name).toBe('Design');
    expect(findings.find((f) => f.category === 'underused')!.refs[0]!.name).toBe('Ops');
    const move = findings.find((f) => f.category === 'redistribute')!;
    expect(move.basis).toBe('estimate');
    expect(move.summary).toContain('could');
    expect(move.summary).not.toMatch(/\b(assign|assigned|reassigned)\b/i);
  });
  it('notes a dip from time off', () => {
    const { findings } = capacityFindings({ period, teams: [team('Design', { timeOffSeconds: 30 * H })] });
    expect(findings.find((f) => f.category === 'time_off_dip')).toMatchObject({ basis: 'fact' });
  });
  it('invents nothing for a team without schedules', () => {
    const r = capacityFindings({ period, teams: [team('Sales', { scheduledSeconds: null })] });
    expect(r.findings).toEqual([]);
    expect(r.limitations).toContain('No schedules for Sales; capacity cannot be estimated.');
  });
  it('a balanced team gives nothing to act on', () => {
    expect(capacityFindings({ period, teams: [team('Design', {})] }).findings).toEqual([]);
  });
});
