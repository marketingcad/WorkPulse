import { describe, expect, it } from 'vitest';
import { phoneProblem } from '@tallywork/contracts/phone';
import { phoneValue } from '../lib/phone';
import { loadPhone, loadedPhone } from '../lib/phone-lazy';
import { defaultPhoneCountry } from '../lib/phone-region';

/** The phone module loads on demand (bundle budget, 20 Nov 2026); the checks then use the same module. */
describe('the phone module on demand', () => {
  it('is not loaded until asked for, then loads once and is the real module', async () => {
    expect(loadedPhone()).toBeNull();
    const [a, b] = await Promise.all([loadPhone(), loadPhone()]);
    expect(a).toBe(b);
    expect(loadedPhone()).toBe(a);
    expect(a.phoneProblem).toBe(phoneProblem);
    expect(a.phoneProblem('+63 917 123 4567')).toBeNull();
    expect(a.phoneProblem('12')).toBe(a.PHONE_COUNTRY_MESSAGE);
  });

  it('starts a new number in the browser’s region without loading it, else the United States', () => {
    const lang = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const set = (language: string | undefined) => Object.defineProperty(globalThis, 'navigator', { value: language === undefined ? undefined : { language }, configurable: true });
    try {
      set('en-PH');
      expect(defaultPhoneCountry()).toBe('PH');
      set('fr');
      expect(defaultPhoneCountry()).toBe('FR');
      set(undefined);
      expect(defaultPhoneCountry()).toBe('US');
    } finally {
      if (lang) Object.defineProperty(globalThis, 'navigator', lang);
      else delete (globalThis as { navigator?: unknown }).navigator;
    }
  });
});

/** Form validation audit, 20 Nov 2026: what the phone field sends for a country and a typed number. */
describe('phoneValue', () => {
  it('sends a valid number in E.164', () => {
    expect(phoneValue('PH', '9171234567')).toBe('+639171234567');
    expect(phoneValue('PH', '0917 123 4567')).toBe('+639171234567');
    expect(phoneValue('GB', '020 7946 0958')).toBe('+442079460958');
  });

  it('uses a pasted country code over the chosen country', () => {
    expect(phoneValue('US', '+63 917 123 4567')).toBe('+639171234567');
  });

  it('sends nothing for an empty field, so the number is cleared', () => {
    expect(phoneValue('US', '   ')).toBe('');
  });

  it('sends an invalid number with its country code, so the server’s rule names the problem', () => {
    expect(phoneProblem(phoneValue('PH', '12345'))).toBe('Enter a valid phone number');
    expect(phoneProblem(phoneValue('US', '555-CALL'))).toBe('Use digits only (spaces, dashes and brackets are fine)');
  });
});
