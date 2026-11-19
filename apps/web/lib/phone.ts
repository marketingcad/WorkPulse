import { callingCode, toE164, type CountryCode } from '@tallywork/contracts/phone';

// Imports the phone module (libphonenumber): only the phone field (loaded on demand) uses it.

/**
 * What the form sends for a country and the number typed: E.164 when it is valid ("+639171234567"),
 * otherwise the number with its country code, so `phoneProblem(value)` (the server's rule) says what is
 * wrong. Empty when nothing is typed.
 */
export function phoneValue(country: CountryCode, national: string): string {
  const typed = national.trim();
  if (!typed) return '';
  if (typed.startsWith('+')) return toE164(typed) ?? typed;
  return toE164(typed, country) ?? `${callingCode(country)} ${typed}`;
}
