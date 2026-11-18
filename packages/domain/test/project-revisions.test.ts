import { describe, expect, it } from 'vitest';
import { projectProgressPct, projectRevisionChanges } from '../src/project-revisions';

describe('projectRevisionChanges', () => {
  it('reports only the fields that changed, with previous and new values', () => {
    const changes = projectRevisionChanges({ name: 'Site', status: 'ACTIVE', color: '#111111' }, { name: 'Website', status: 'ACTIVE', color: '#111111' }, { includeRates: true });
    expect(changes).toEqual([{ field: 'name', before: 'Site', after: 'Website', before_known: true }]);
  });

  it('ignores fields a partial update did not send', () => {
    expect(projectRevisionChanges({ name: 'A', description: 'x' }, { name: 'B' }, { includeRates: true }).map((c) => c.field)).toEqual(['name']);
  });

  it('treats member and team lists as sets', () => {
    expect(projectRevisionChanges({ member_ids: ['a', 'b'] }, { member_ids: ['b', 'a'] }, { includeRates: true })).toEqual([]);
    expect(projectRevisionChanges({ member_ids: ['a'] }, { member_ids: ['b', 'a'] }, { includeRates: true })).toEqual([{ field: 'member_ids', before: ['a'], after: ['a', 'b'], before_known: true }]);
  });

  it('treats an empty string and a missing value as empty', () => {
    expect(projectRevisionChanges({ description: null }, { description: '' }, { includeRates: true })).toEqual([]);
  });

  it('marks older revisions without previous values', () => {
    expect(projectRevisionChanges(null, { status: 'ON_HOLD' }, { includeRates: true })).toEqual([{ field: 'status', before: null, after: 'ON_HOLD', before_known: false }]);
  });

  it('hides rates from people who cannot read them', () => {
    const after = { bill_rate_minor: 9000, name: 'X' };
    expect(projectRevisionChanges({ bill_rate_minor: 100, name: 'X' }, after, { includeRates: false })).toEqual([]);
    expect(projectRevisionChanges({ bill_rate_minor: 100, name: 'X' }, after, { includeRates: true }).map((c) => c.field)).toEqual(['bill_rate_minor']);
  });

  it('ignores fields that are not part of a project revision', () => {
    expect(projectRevisionChanges({}, { change_reason: 'why', rate_effective_from: '2026-01-01' }, { includeRates: true })).toEqual([]);
  });

  it('returns nothing without after values', () => {
    expect(projectRevisionChanges({ name: 'a' }, null, { includeRates: true })).toEqual([]);
  });
});

describe('projectProgressPct', () => {
  it('is the rounded share of done tasks, or null without tasks', () => {
    expect(projectProgressPct(0, 0)).toBeNull();
    expect(projectProgressPct(1, 3)).toBe(33);
    expect(projectProgressPct(3, 3)).toBe(100);
    expect(projectProgressPct(5, 3)).toBe(100);
  });
});
