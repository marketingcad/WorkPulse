import { describe, expect, it } from 'vitest';
import { AVATAR_PRESET_GROUPS, avatarBackground, avatarHue, initials, isAvatarPreset } from '../src/avatar';
import { AVATAR_PRESETS } from '../../contracts/src/avatars';

/** Initials, their colors and the curated collection (profile avatar experience). */
describe('initials', () => {
  it('takes the first and last words, so a renamed person updates at once', () => {
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('Ana María López García')).toBe('AG');
    expect(initials('  cher  ')).toBe('C');
    expect(initials('')).toBe('');
    // Letters outside ASCII stay whole.
    expect(initials('Émile Zola')).toBe('ÉZ');
    expect(initials('李 小龙')).toBe('李小');
  });
});

describe('initials colors', () => {
  it('come from a stable id, the same every time, not from the name', () => {
    expect(avatarHue('01a1a7be-35e0-7759-8747-906714e131ef')).toBe(avatarHue('01a1a7be-35e0-7759-8747-906714e131ef'));
    expect(avatarHue('a')).not.toBe(avatarHue('b'));
  });

  it('keep white initials at WCAG AA contrast (4.5:1) for every hue', () => {
    const lum = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    for (let h = 0; h < 360; h++) {
      const m = /hsl\((\d+) (\d+)% (\d+)%\)/.exec(avatarBackground(h))!;
      const [s, l] = [Number(m[2]) / 100, Number(m[3]) / 100];
      const f = (n: number) => {
        const k = (n + h / 30) % 12;
        return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      };
      const L = 0.2126 * lum(f(0)) + 0.7152 * lum(f(8)) + 0.0722 * lum(f(4));
      expect((1.05 / (L + 0.05)), `hue ${h}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('curated avatars', () => {
  it('has artwork for exactly the ids the API accepts, in three groups', () => {
    const shown = AVATAR_PRESET_GROUPS.flatMap((g) => g.presets);
    expect(new Set(shown)).toEqual(new Set(AVATAR_PRESETS));
    expect(shown).toHaveLength(AVATAR_PRESETS.length);
    for (const id of AVATAR_PRESETS) expect(isAvatarPreset(id)).toBe(true);
    expect(isAvatarPreset('emoji-1')).toBe(false);
    expect(AVATAR_PRESET_GROUPS.map((g) => g.id)).toEqual(['people', 'minimal', 'shapes']);
    expect(AVATAR_PRESET_GROUPS[0]!.presets.length).toBeGreaterThanOrEqual(6);
  });
});
