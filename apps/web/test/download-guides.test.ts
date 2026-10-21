import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GUIDES, guideImagePath, isGuidePlatform } from '../components/download/guides';

const shotList = readFileSync(new URL('../../../docs/ops/download-guide-screenshots.md', import.meta.url), 'utf8');

describe('desktop setup guides', () => {
  it.each(Object.values(GUIDES))('$name: every step names its own numbered PNG and says what it shows', (g) => {
    const files = g.steps.map((s) => s.image);
    expect(new Set(files).size).toBe(files.length);
    files.forEach((f, i) => expect(f).toMatch(new RegExp(`^${String(i + 1).padStart(2, '0')}-[a-z0-9-]+\\.png$`)));
    for (const s of g.steps) {
      expect(s.title.trim()).not.toBe('');
      expect(s.shows.length).toBeGreaterThan(20);
      // The shot list for whoever takes the screenshots names every file.
      expect(shotList).toContain(`\`${s.image}\``);
    }
  });

  it('serves images from the platform folder and knows only real platforms', () => {
    expect(guideImagePath('macos', '01-open-dmg.png')).toBe('/download-guides/macos/01-open-dmg.png');
    expect(isGuidePlatform('windows')).toBe(true);
    expect(isGuidePlatform('../etc')).toBe(false);
  });
});
