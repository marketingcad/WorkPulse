import { systemPreferences } from 'electron';
import type { MacPermissions } from '../../shared/permissions';

/**
 * What macOS currently allows this app. Asking does not prompt the person (`false` below), so it is
 * safe to read often; the answer changes as soon as they turn the app on in System Settings.
 */
export function macPermissions(): MacPermissions | null {
  if (process.platform !== 'darwin') return null;
  return { screenRecording: systemPreferences.getMediaAccessStatus('screen') === 'granted', accessibility: systemPreferences.isTrustedAccessibilityClient(false) };
}
