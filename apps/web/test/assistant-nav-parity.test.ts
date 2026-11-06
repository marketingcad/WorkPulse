import { describe, expect, it } from 'vitest';
import { NAV_TARGETS, NAV_TARGET_KEYS } from '@tallywork/domain/assistant';
import { NAV } from '../components/shell/nav';

const entries = NAV.flatMap((g) => g.items).flatMap((i) => [i, ...(i.tabs ?? [])]);

describe('assistant nav allowlist parity with the web nav', () => {
  for (const key of NAV_TARGET_KEYS) {
    it(`${key} matches its NAV entry`, () => {
      const t = NAV_TARGETS[key];
      // An item with tabs stands for its first tab; match the tab or plain item with this href.
      const candidates = entries.filter((e) => e.href === t.path && (!('tabs' in e) || !e.tabs));
      expect(candidates.length).toBeGreaterThan(0);
      const e = candidates[0]!;
      expect(t.perms).toEqual(e.perms);
      expect(t.minScope).toEqual(e.minScope);
    });
  }
});
