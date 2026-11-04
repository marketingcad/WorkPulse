import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, type TrackingPolicy } from '@tallywork/domain';
import { trackingDisclosure } from '../src/shared/disclosure';

const ALL = { input: true, screenshots: true, apps: true, urls: true };
const policy = (p: Partial<{ [K in keyof TrackingPolicy]: Partial<TrackingPolicy[K]> }>): TrackingPolicy =>
  Object.fromEntries(Object.entries(DEFAULT_POLICY).map(([k, v]) => [k, { ...v, ...(p as Record<string, object>)[k] }])) as unknown as TrackingPolicy;
const item = (p: TrackingPolicy, key: string, caps = ALL) => trackingDisclosure(p, caps).find((i) => i.key === key)!;

describe('trackingDisclosure', () => {
  it('lists every kind of data, time always on', () => {
    expect(trackingDisclosure(DEFAULT_POLICY, ALL).map((i) => i.key)).toEqual(['time', 'activity', 'screenshots', 'apps', 'websites', 'idle']);
    expect(item(DEFAULT_POLICY, 'time').on).toBe(true);
  });

  it('describes screenshots with their frequency, blur and notice', () => {
    const p = policy({ screenshots: { enabled: true, perTenMinutes: 2, blur: true, notify: true } });
    const s = item(p, 'screenshots');
    expect(s.on).toBe(true);
    expect(s.detail).toMatch(/^2 every 10 minutes, of every screen, blurred/);
    expect(s.detail).toMatch(/notice each time/);
    // Enabled but set to 0 per 10 minutes takes none.
    expect(item(policy({ screenshots: { enabled: true, perTenMinutes: 0 } }), 'screenshots')).toMatchObject({ on: false, detail: 'Not taken.' });
  });

  it('says the activity level never records what is typed', () => {
    expect(item(DEFAULT_POLICY, 'activity').detail).toMatch(/never recorded/);
    expect(item(policy({ activity: { enabled: false } }), 'activity')).toMatchObject({ on: false, detail: 'Not recorded by your organization.' });
  });

  it('distinguishes site names from full addresses, and counts excluded sites', () => {
    expect(item(policy({ urls: { enabled: true, mode: 'domain', excludedDomains: ['bank.example'] } }), 'websites').detail).toMatch(/site name only.*1 site is never recorded/);
    expect(item(policy({ urls: { enabled: true, mode: 'full', excludedDomains: [] } }), 'websites').detail).toMatch(/full address/);
  });

  it('is off, and says so, when this computer does not allow a monitor', () => {
    const a = item(policy({ apps: { enabled: true } }), 'apps', { ...ALL, apps: false });
    expect(a.on).toBe(false);
    expect(a.detail).toMatch(/does not allow it/);
  });

  it('explains what happens after idle time, per behavior', () => {
    expect(item(policy({ idle: { enabled: true, thresholdMinutes: 5, behavior: 'prompt' } }), 'idle').detail).toMatch(/After 5 minutes.*asked whether/);
    expect(item(policy({ idle: { enabled: true, thresholdMinutes: 1, behavior: 'pause' } }), 'idle').detail).toMatch(/After 1 minute .*pauses/);
  });
});
