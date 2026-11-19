import { describe, expect, it } from 'vitest';
import { clientInput, memberDetailsInput } from '../src/inputs';
import { COMMON_COUNTRIES, PHONE_CHARACTERS_MESSAGE, PHONE_COUNTRY_MESSAGE, PHONE_MESSAGE, countryOptions, formatNational, phoneParts, phoneProblem, toE164 } from '../src/phone';

/** Form validation audit, 20 Nov 2026: phone numbers are checked per country and stored in E.164. */
describe('phone numbers', () => {
  it.each([
    ['PH', '9171234567', '+639171234567'],
    ['PH', '0917 123 4567', '+639171234567'],
    ['US', '(415) 555-2671', '+14155552671'],
    ['GB', '020 7946 0958', '+442079460958'],
    ['CA', '416-555-0199', '+14165550199'],
    ['AU', '0412 345 678', '+61412345678'],
    ['SG', '8123 4567', '+6581234567'],
    ['JP', '090-1234-5678', '+819012345678'],
    ['AE', '050 123 4567', '+971501234567'],
  ] as const)('%s %s is stored as %s', (country, typed, e164) => {
    expect(phoneProblem(typed, country)).toBeNull();
    expect(toE164(typed, country)).toBe(e164);
  });

  it('reads a number that has its own country code, whatever country is chosen', () => {
    expect(toE164('+63 917 123 4567', 'US')).toBe('+639171234567');
  });

  it('checks the length each country uses', () => {
    expect(phoneProblem('917123456', 'PH')).toBe(PHONE_MESSAGE); // one digit short
    expect(phoneProblem('91712345678', 'PH')).toBe(PHONE_MESSAGE); // one too many
    expect(phoneProblem('8123 4567', 'SG')).toBeNull(); // Singapore numbers have 8 digits …
    expect(phoneProblem('8123 4567', 'US')).toBe(PHONE_MESSAGE); // … US numbers have 10
  });

  it('refuses letters and symbols', () => {
    expect(phoneProblem('917-CALL-NOW', 'PH')).toBe(PHONE_CHARACTERS_MESSAGE);
    expect(phoneProblem('+63 917 123 4567 ext 2', 'PH')).toBe(PHONE_CHARACTERS_MESSAGE);
    expect(phoneProblem('<script>', 'PH')).toBe(PHONE_CHARACTERS_MESSAGE);
  });

  it('needs a country code when no country is chosen (the API)', () => {
    expect(phoneProblem('9171234567')).toBe(PHONE_COUNTRY_MESSAGE);
    expect(phoneProblem('+639171234567')).toBeNull();
  });

  it('splits a stored number for the form, and keeps old free text to be corrected', () => {
    expect(phoneParts('+639171234567', 'US')).toEqual({ country: 'PH', national: '0917 123 4567' });
    expect(phoneParts('call reception', 'US')).toEqual({ country: 'US', national: 'call reception' });
    expect(phoneParts(null, 'GB')).toEqual({ country: 'GB', national: '' });
    expect(formatNational('4155552671', 'US')).toBe('(415) 555-2671');
    expect(formatNational('41555', 'US')).toBe('41555');
  });

  it('lists the common countries first, then every other country', () => {
    const list = countryOptions();
    expect(list.slice(0, COMMON_COUNTRIES.length).map((c) => c.code)).toEqual([...COMMON_COUNTRIES]);
    expect(list[1]).toMatchObject({ code: 'PH', name: 'Philippines', calling: '+63', flag: '🇵🇭' });
    expect(list.length).toBeGreaterThan(200);
  });
});

describe('API schemas', () => {
  it('store E.164, clear on blank, and refuse invalid numbers', () => {
    expect(memberDetailsInput.parse({ phone: ' +63 917-123-4567 ', emergency_contact_phone: '' })).toMatchObject({ phone: '+639171234567', emergency_contact_phone: null });
    expect(clientInput.safeParse({ name: 'Globex', phone: '12345' }).success).toBe(false);
    expect(clientInput.safeParse({ name: 'Globex', phone: '9171234567' }).error?.issues[0]?.message).toBe(PHONE_COUNTRY_MESSAGE);
  });
});
