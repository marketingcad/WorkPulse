import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The /download page and the IT guide link to .../releases/latest/download/<name>, so every installer
// people download must keep a name without the version. 0.3.0 regressed: built together with the msi,
// the Windows installer took the msi's versioned name and the Windows download link returned 404.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const builder = readFileSync(path.join(root, 'apps/desktop/electron-builder.yml'), 'utf8');
const workflow = readFileSync(path.join(root, '.github/workflows/desktop-release.yml'), 'utf8');

/** The `key: value` lines directly under a top-level section (two-space indent). */
function section(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inside = false;
  for (const line of builder.split(/\r?\n/)) {
    if (/^\S/.test(line)) inside = line.startsWith(`${name}:`);
    else if (inside) {
      const m = /^ {2}(\w+):\s*(.*)$/.exec(line);
      if (m && !m[2]!.startsWith('#')) out[m[1]!] = m[2]!.trim();
    }
  }
  return out;
}

describe('installer file names', () => {
  it('the Windows installer keeps its stable name, stated on the nsis target itself', () => {
    expect(section('nsis').artifactName).toBe('Tallywork-Setup.${ext}');
    expect(section('win').artifactName).toBe('Tallywork-Setup.${ext}');
  });

  it('the per-machine msi has its own versioned name, so the two never collide', () => {
    expect(section('msi').artifactName).toBe('Tallywork-${version}-x64.${ext}');
  });

  it('macOS and Linux downloads keep their stable names', () => {
    expect(section('mac').artifactName).toBe('Tallywork-mac.${ext}');
    expect(section('linux').artifactName).toBe('Tallywork-linux.${ext}');
  });

  it('the release workflow builds both Windows installers', () => {
    expect(workflow).toMatch(/targets: --win nsis msi\b/);
  });
});
