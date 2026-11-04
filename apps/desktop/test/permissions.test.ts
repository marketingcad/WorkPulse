import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, type TrackingPolicy } from '@tallywork/domain';
import { permissionNeeds } from '../src/shared/permissions';

const policy = (p: Partial<TrackingPolicy>): TrackingPolicy => ({ ...DEFAULT_POLICY, ...p });

describe('permissionNeeds (macOS)', () => {
  it('asks for nothing on Windows and Linux, or when everything is allowed', () => {
    expect(permissionNeeds(DEFAULT_POLICY, null)).toEqual([]);
    expect(permissionNeeds(DEFAULT_POLICY, { screenRecording: true, accessibility: true })).toEqual([]);
  });

  it('asks for Screen Recording only when screenshots are taken', () => {
    const none = { screenRecording: false, accessibility: true };
    expect(permissionNeeds(policy({ screenshots: { ...DEFAULT_POLICY.screenshots, enabled: false } }), none)).toEqual([]);
    expect(permissionNeeds(policy({ screenshots: { ...DEFAULT_POLICY.screenshots, enabled: true, perTenMinutes: 1 } }), none)).toEqual([{ kind: 'screen', setting: 'Screen Recording', needed: 'screenshots' }]);
  });

  it('asks for Accessibility for what the policy records with it', () => {
    const p = policy({ activity: { enabled: true }, apps: { enabled: true }, urls: { ...DEFAULT_POLICY.urls, enabled: true } });
    expect(permissionNeeds(p, { screenRecording: true, accessibility: false })).toEqual([{ kind: 'accessibility', setting: 'Accessibility', needed: 'activity levels, app names and websites' }]);
    expect(permissionNeeds(policy({ activity: { enabled: false }, apps: { enabled: false }, urls: { ...DEFAULT_POLICY.urls, enabled: false } }), { screenRecording: true, accessibility: false })).toEqual([]);
  });
});
