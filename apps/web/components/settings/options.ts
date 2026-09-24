export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'JPY', 'CNY', 'HKD', 'SGD', 'INR', 'PHP', 'IDR', 'MYR', 'THB', 'VND', 'KRW', 'BRL', 'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'ZAR', 'NGN', 'KES', 'EGP', 'AED', 'SAR', 'ILS', 'TRY', 'UAH', 'RON', 'HUF', 'PKR', 'BDT'];

const FALLBACK_ZONES = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Africa/Lagos', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney'];

/** IANA zones supported by this browser, always including `current`. */
export function timeZones(current?: string): string[] {
  let list: string[] = FALLBACK_ZONES;
  try {
    list = Intl.supportedValuesOf('timeZone');
  } catch {
    /* older browser */
  }
  const out = ['UTC', ...list.filter((z) => z !== 'UTC')];
  if (current && !out.includes(current)) out.unshift(current);
  return out;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
