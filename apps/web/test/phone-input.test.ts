import { describe, expect, it } from 'vitest';
import { phoneProblem } from '@tallywork/contracts/phone';
import { phoneValue } from '../lib/phone';

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
