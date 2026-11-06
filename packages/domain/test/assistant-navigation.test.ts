import { describe, expect, it } from 'vitest';
import { ROLE_PRESETS } from '../src/permissions';
import { NAV_TARGETS, NAV_TARGET_KEYS, gateAllows, resolveNav, sectionFor, suggestionsFor } from '../src/assistant';

const ORG = '0190aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee';
const admin = ROLE_PRESETS.SYSTEM_ADMIN;
const manager = ROLE_PRESETS.TEAM_MANAGER;
const worker = ROLE_PRESETS.WORKER;

describe('resolveNav', () => {
  it('resolves an allowed key to an org-scoped href', () => {
    expect(resolveNav(admin, ORG, 'timesheets.approvals')).toEqual({
      key: 'timesheets.approvals',
      label: 'Approvals',
      href: `/o/${ORG}/timesheets/approvals`,
    });
    expect(resolveNav(admin, ORG, 'dashboard')?.href).toBe(`/o/${ORG}`);
  });
  it('refuses a page the person may not open', () => {
    expect(resolveNav(manager, ORG, 'finance.payroll')).toBeNull();
    expect(resolveNav(worker, ORG, 'workers')).toBeNull();
  });
  it('refuses anything that is not an exact key', () => {
    for (const k of ['javascript:alert(1)', '../x', '/workers', 'workers/', 'work', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '', 'https://evil']) {
      expect(resolveNav(admin, ORG, k)).toBeNull();
    }
    expect(resolveNav(admin, ORG, undefined as unknown as string)).toBeNull();
  });
  it('gives every key a path starting with / (or empty)', () => {
    for (const k of NAV_TARGET_KEYS) expect(NAV_TARGETS[k].path === '' || NAV_TARGETS[k].path.startsWith('/')).toBe(true);
  });
});

describe('gateAllows', () => {
  it('allows when no perms, honours team_or_org', () => {
    expect(gateAllows({}, {})).toBe(true);
    const g = { perms: ['time:read' as const], minScope: 'team_or_org' as const };
    expect(gateAllows({ 'time:read': 'own' }, g)).toBe(false);
    expect(gateAllows({ 'time:read': 'assigned' }, g)).toBe(false);
    expect(gateAllows({ 'time:read': 'team' }, g)).toBe(true);
    expect(gateAllows({ 'time:read': 'org' }, g)).toBe(true);
    expect(gateAllows({ 'time:read': 'own' }, { perms: ['time:read'] })).toBe(true);
  });
});

describe('sectionFor', () => {
  it('maps a route to the longest matching section', () => {
    expect(sectionFor(`/o/${ORG}/timesheets/approvals?x=1`)).toBe('timesheets.approvals');
    expect(sectionFor(`/o/${ORG}/settings/policies`)).toBe('settings.policies');
    expect(sectionFor(`/o/${ORG}/workers/123`)).toBe('workers');
    expect(sectionFor(`/o/${ORG}`)).toBe('dashboard');
    expect(sectionFor(`/o/${ORG}/`)).toBe('dashboard');
  });
  it('returns null for unknown or foreign routes', () => {
    expect(sectionFor('https://evil/o/x')).toBeNull();
    expect(sectionFor(`/o/${ORG}/nope`)).toBeNull();
    expect(sectionFor('/login')).toBeNull();
    expect(sectionFor(`/o/${ORG}/workersx`)).toBeNull();
  });
});

describe('suggestionsFor', () => {
  it('gives a worker only docs questions', () => {
    const s = suggestionsFor(worker, null);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s).not.toContain('Who is working right now?');
    expect(s).not.toContain('How many hours did the team log this week?');
  });
  it('gives 3 to 4 entries for an admin on approvals, without duplicates', () => {
    const s = suggestionsFor(admin, 'timesheets.approvals');
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s.length).toBeLessThanOrEqual(4);
    expect(new Set(s).size).toBe(s.length);
    expect(s[0]).toBe('Which timesheets are awaiting approval?');
  });
  it('falls back to general questions for every section', () => {
    for (const k of NAV_TARGET_KEYS) {
      const n = suggestionsFor(worker, k).length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(4);
    }
  });
});
