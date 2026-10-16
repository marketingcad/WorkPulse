import type { AppUpdater } from 'electron-updater';

type UpdaterModule = { autoUpdater?: AppUpdater; default?: { autoUpdater?: AppUpdater } };

/**
 * electron-updater is a CommonJS package. Imported from this ES module, its `autoUpdater` is not a
 * named export (it is a lazy getter that Node cannot detect), only a property of the default export.
 * Reading it as a named export gave `undefined` and broke every update check up to 0.1.5.
 */
export async function loadAutoUpdater(load: () => Promise<unknown> = () => import('electron-updater')): Promise<AppUpdater> {
  const mod = (await load()) as UpdaterModule;
  const updater = mod.autoUpdater ?? mod.default?.autoUpdater;
  if (!updater) throw new Error('electron-updater did not provide autoUpdater');
  return updater;
}
