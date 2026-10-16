import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAutoUpdater } from '../src/main/services/updater';

// Auto-update never ran up to 0.1.5: the app read `autoUpdater` as a named export of the CommonJS
// electron-updater package, which is undefined when imported from an ES module, so the first
// property assignment threw and every update check was silently skipped.
describe('loading the auto-updater', () => {
  it('electron-updater only exposes autoUpdater on its default export when imported from ESM', () => {
    // Node's own ESM loader, as in the packaged app; Vitest's loader adds named exports itself.
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', "const m = await import('electron-updater'); console.log(JSON.stringify({ named: Object.keys(m).includes('autoUpdater'), onDefault: Object.getOwnPropertyNames(m.default).includes('autoUpdater') }))"],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' },
    );
    expect(JSON.parse(out)).toEqual({ named: false, onDefault: true });
  });

  it('finds autoUpdater on the default export (how Node loads the CommonJS package)', async () => {
    const updater = { channel: 'latest' };
    expect(await loadAutoUpdater(async () => ({ default: { autoUpdater: updater } }))).toBe(updater);
  });

  it('also accepts a named export, should the package ship as an ES module', async () => {
    const updater = { channel: 'latest' };
    expect(await loadAutoUpdater(async () => ({ autoUpdater: updater }))).toBe(updater);
  });

  it('fails loudly instead of leaving the updater undefined', async () => {
    await expect(loadAutoUpdater(async () => ({ default: {} }))).rejects.toThrow('did not provide autoUpdater');
  });
});
