import { describe, expect, it } from 'vitest';
import { policyDocInput } from '@tallywork/contracts';
import { DEFAULT_POLICY } from '@tallywork/domain';
import { POLICY_SECTIONS, type PolicyField } from '../components/settings/policy-fields';

/**
 * Settings › Tracking policies offers exactly what the server accepts: a number field's limits are
 * the API's (so the form never offers a value the server refuses, or hides one it allows), and every
 * tracking setting, such as the desktop app's confirm window, can be changed here, not only through
 * the API.
 */
const numberFields = POLICY_SECTIONS.flatMap((s) => s.fields).filter((f): f is PolicyField & { kind: { type: 'number'; min: number; max: number; unit: string } } => f.kind.type === 'number');
const accepts = (f: PolicyField, value: number) => policyDocInput.safeParse({ [f.section]: { [f.key]: value } }).success;

describe('tracking policy fields', () => {
  it.each(numberFields.map((f) => [`${f.section}.${f.key}`, f] as const))('%s: the form limits are the API limits', (_name, f) => {
    expect(accepts(f, f.kind.min)).toBe(true);
    expect(accepts(f, f.kind.max)).toBe(true);
    expect(accepts(f, f.kind.min - 1)).toBe(false);
    expect(accepts(f, f.kind.max + 1)).toBe(false);
  });

  it('every tracking setting has a field, with its default inside the field limits', () => {
    const tracking = POLICY_SECTIONS.find((s) => s.key === 'tracking')!.fields;
    expect(tracking.map((f) => f.key).sort()).toEqual(Object.keys(DEFAULT_POLICY.tracking).sort());
    for (const f of tracking) {
      if (f.kind.type !== 'number') continue;
      const value = DEFAULT_POLICY.tracking[f.key as keyof typeof DEFAULT_POLICY.tracking] as number;
      expect(value, f.key).toBeGreaterThanOrEqual(f.kind.min);
      expect(value, f.key).toBeLessThanOrEqual(f.kind.max);
    }
  });

  it('should_offer_the_desktop_confirm_window_from_60_to_900_seconds_defaulting_to_120', () => {
    const f = numberFields.find((x) => x.key === 'confirmTimeoutSeconds')!;
    expect(f).toBeDefined();
    expect(f.kind).toMatchObject({ min: 60, max: 900, unit: 'sec' });
    expect(DEFAULT_POLICY.tracking.confirmTimeoutSeconds).toBe(120);
  });
});
