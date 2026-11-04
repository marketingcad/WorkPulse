import type { TrackingPolicy } from '@tallywork/domain';

/** macOS privacy permissions the app depends on; null on Windows and Linux, where none are asked. */
export interface MacPermissions {
  /** Privacy & Security › Screen Recording: screenshots */
  screenRecording: boolean;
  /** Privacy & Security › Accessibility: keyboard and mouse counts, app and window names */
  accessibility: boolean;
}

export type PermissionKind = 'screen' | 'accessibility';

export interface PermissionNeed {
  kind: PermissionKind;
  /** the System Settings list to turn the app on in */
  setting: string;
  /** what the organization records that needs it, for the explanation */
  needed: string;
}

/**
 * The permissions this organization's policy needs and macOS has not given yet. Without them the
 * monitors record nothing (silently, before), so the worker is shown what to turn on and where.
 */
export function permissionNeeds(policy: TrackingPolicy | null, perms: MacPermissions | null): PermissionNeed[] {
  if (!policy || !perms) return [];
  const needs: PermissionNeed[] = [];
  if (policy.screenshots.enabled && policy.screenshots.perTenMinutes > 0 && !perms.screenRecording) needs.push({ kind: 'screen', setting: 'Screen Recording', needed: 'screenshots' });
  const input = [policy.activity.enabled && 'activity levels', policy.apps.enabled && 'app names', policy.urls.enabled && 'websites'].filter((x): x is string => !!x);
  if (input.length && !perms.accessibility) needs.push({ kind: 'accessibility', setting: 'Accessibility', needed: input.join(', ').replace(/, ([^,]*)$/, ' and $1') });
  return needs;
}

/** The System Settings pane for each permission (opened by the main process). */
export const PERMISSION_SETTINGS_URL: Record<PermissionKind, string> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
};
