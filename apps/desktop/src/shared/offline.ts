/**
 * Offline as a controlled, temporary mode. The app may track without a connection, from the
 * account and tracking settings it last loaded, for at most the organization's "max offline hours"
 * counted from the last time it reached the server. The server applies the same window when the
 * time arrives (a session interrupted for longer is stopped), so time tracked after it would not be
 * accepted: the app stops offering new sessions once it has passed.
 */
export type OfflineMode = 'online' | 'offline' | 'expired';

export interface OfflineStatus {
  mode: OfflineMode;
  /** when the account and tracking settings in use were loaded (set while running from the saved copy) */
  settingsSavedAt: string | null;
  /** when offline tracking stops being allowed (set while offline) */
  allowedUntil: string | null;
  /** today/week totals cover only time tracked on this computer since the settings were saved on another day */
  totalsPartial: boolean;
  /** the app paused tracking because offline tracking ran out at this time (set by the agent) */
  pausedAt?: string | null;
}

export function offlineStatus(o: { online: boolean; fromCache: boolean; settingsSavedAt: number | null; lastContactAt: number | null; maxOfflineHours: number; totalsPartial: boolean; now: number }): OfflineStatus {
  const savedAt = o.fromCache && o.settingsSavedAt !== null ? new Date(o.settingsSavedAt).toISOString() : null;
  if (o.online) return { mode: 'online', settingsSavedAt: savedAt, allowedUntil: null, totalsPartial: o.totalsPartial };
  const until = o.lastContactAt === null ? null : o.lastContactAt + o.maxOfflineHours * 3600_000;
  return { mode: until !== null && o.now > until ? 'expired' : 'offline', settingsSavedAt: savedAt, allowedUntil: until === null ? null : new Date(until).toISOString(), totalsPartial: o.totalsPartial };
}

/** The refusal shown when a session cannot start because the offline window has passed. */
export function expiredMessage(maxOfflineHours: number): string {
  return `You have been offline for more than ${maxOfflineHours} ${maxOfflineHours === 1 ? 'hour' : 'hours'}, the longest your organization allows. Connect to the internet to clock in. Time already saved on this computer is kept.`;
}
