import { callingCode, isCountryCode, toE164, type CountryCode } from '@tallywork/contracts/phone';

/** The country a new number starts in: the browser's region ("en-PH" → PH), else the United States. */
export function defaultPhoneCountry(): CountryCode {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (isCountryCode(region)) return region;
  } catch {
    // no navigator (server render) or an unusual locale
  }
  return 'US';
}

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
