/**
 * Phone numbers, shared by the API schemas and the browser (no zod here, so pages can import it alone as
 * @tallywork/contracts/phone). Numbers are stored in E.164 ("+639171234567"), checked against each
 * country's own lengths and prefixes with Google's numbering plan data (libphonenumber, "min" set: it
 * checks lengths and leading digits per country, not every digit pattern). Form validation audit, 20
 * Nov 2026: every phone field accepted any text up to 50 characters.
 */
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

export type { CountryCode };

export const PHONE_MESSAGE = 'Enter a valid phone number';
export const PHONE_CHARACTERS_MESSAGE = 'Use digits only (spaces, dashes and brackets are fine)';
export const PHONE_COUNTRY_MESSAGE = 'Include the country code, like +1 or +63';

/** What people type around the digits: spaces, dashes, dots, slashes, brackets and a leading +. */
const ALLOWED = /^\+?[\d\s\-.()/]+$/;

/** Countries listed first in pickers: the ones people here use most. */
export const COMMON_COUNTRIES: readonly CountryCode[] = ['US', 'PH', 'GB', 'CA', 'AU', 'SG', 'JP', 'AE'];

export function isCountryCode(v: string | null | undefined): v is CountryCode {
  return !!v && (getCountries() as string[]).includes(v);
}

/**
 * What is wrong with a phone number, or null when it is valid. `country` is used when the number has
 * no "+" country code; without either, the country code is required.
 */
export function phoneProblem(raw: string, country?: CountryCode): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (!ALLOWED.test(v)) return PHONE_CHARACTERS_MESSAGE;
  if (!v.startsWith('+') && !country) return PHONE_COUNTRY_MESSAGE;
  const p = parsePhoneNumberFromString(v, country);
  return p?.isValid() ? null : PHONE_MESSAGE;
}

/** The number in E.164 ("+639171234567"), or null when it is empty or not valid. */
export function toE164(raw: string, country?: CountryCode): string | null {
  if (phoneProblem(raw, country) || !raw.trim()) return null;
  return parsePhoneNumberFromString(raw.trim(), country)!.number;
}

/** A stored number split for a form: its country and the national part, formatted for that country. */
export function phoneParts(stored: string | null | undefined, fallback: CountryCode): { country: CountryCode; national: string } {
  const v = (stored ?? '').trim();
  if (!v) return { country: fallback, national: '' };
  const p = parsePhoneNumberFromString(v);
  // A number saved before numbers were checked (free text) is shown as it was, to be corrected.
  if (!p?.country) return { country: fallback, national: v };
  return { country: p.country, national: p.formatNational() };
}

/** The national part formatted the way the country writes it, or as typed when it is not valid yet. */
export function formatNational(national: string, country: CountryCode): string {
  const p = national.trim() && ALLOWED.test(national.trim()) ? parsePhoneNumberFromString(national.trim(), country) : undefined;
  return p?.isValid() ? p.formatNational() : national;
}

/** "+63" for PH. */
export const callingCode = (country: CountryCode) => `+${getCountryCallingCode(country)}`;

/** Flag emoji from the two-letter code (regional indicator symbols). */
export const flag = (country: CountryCode) => String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

export interface CountryOption {
  code: CountryCode;
  name: string;
  calling: string;
  flag: string;
}

/** Every country with a calling code: the common ones first, then the rest by name. */
export function countryOptions(locale = 'en'): CountryOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    names = null;
  }
  const option = (code: CountryCode): CountryOption => ({ code, name: names?.of(code) ?? code, calling: callingCode(code), flag: flag(code) });
  const rest = getCountries()
    .filter((c) => !COMMON_COUNTRIES.includes(c))
    .map(option)
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  return [...COMMON_COUNTRIES.map(option), ...rest];
}

/** A stored number for people to read ("+63 917 123 4567"); text saved before numbers were checked is shown as it is. */
export function displayPhone(stored: string | null | undefined): string {
  const v = (stored ?? '').trim();
  const p = v.startsWith('+') ? parsePhoneNumberFromString(v) : undefined;
  return p?.isValid() ? p.formatInternational() : v;
}
