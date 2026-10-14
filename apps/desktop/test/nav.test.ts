import { describe, expect, it } from 'vitest';
import { GROUP_OF, NAV_GROUPS, groupFor, type NavGroup } from '../src/renderer/src/nav';

// The set of views the app can show, mirrored from lib.ts `View`. Kept here so the test fails loudly
// if a new screen is added without being placed in a nav group.
const VIEWS = ['home', 'tracking', 'projects', 'tasks', 'timesheet', 'activity', 'reports', 'timeoff', 'schedule', 'paystubs', 'settings', 'monitoring', 'manual'] as const;

describe('worker nav model', () => {
  it('presents exactly five primary groups, daily actions first', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(['Home', 'Track', 'Timesheet', 'Time off', 'Me']);
  });

  it('places every view in a group that exists', () => {
    const groupIds = new Set(NAV_GROUPS.map((g) => g.v));
    for (const v of VIEWS) {
      expect(GROUP_OF, `view "${v}" has no group`).toHaveProperty(v);
      expect(groupIds, `view "${v}" maps to unknown group "${GROUP_OF[v]}"`).toContain(GROUP_OF[v]);
    }
  });

  it('has no views beyond the known set (no orphan mappings)', () => {
    expect(Object.keys(GROUP_OF).sort()).toEqual([...VIEWS].sort());
  });

  it('keeps every screen reachable: each group opens a real view, and a tab leads to each grouped view', () => {
    const reachable = new Set<string>();
    for (const g of NAV_GROUPS) {
      reachable.add(g.v); // the group button opens its primary view
      for (const t of g.tabs ?? []) reachable.add(t.v);
    }
    // Every view except the two contextual sub-screens (manual time, the idle/monitoring gate entry
    // "manual") must be reachable directly from the rail or a sub-tab.
    for (const v of VIEWS) {
      if (v === 'manual') continue; // reached from Track screens and Home quick actions, by design
      expect(reachable, `view "${v}" is not reachable from the nav`).toContain(v);
    }
  });

  it("keeps the monitoring disclosure reachable from the nav (it must not be hidden)", () => {
    const meTabs = NAV_GROUPS.find((g) => g.label === 'Me')?.tabs ?? [];
    expect(meTabs.map((t) => t.v)).toContain('monitoring');
  });

  it('groupFor resolves to the owning group for every view', () => {
    for (const v of VIEWS) {
      const g: NavGroup = groupFor(v);
      expect(g.v).toBe(GROUP_OF[v]);
    }
  });

  it("a group's first tab is its own primary view, so opening the group lands on a selected tab", () => {
    for (const g of NAV_GROUPS) {
      if (g.tabs) expect(g.tabs[0]!.v).toBe(g.v);
    }
  });
});
