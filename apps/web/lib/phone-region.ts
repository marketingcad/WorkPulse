/**
 * The country a new phone number starts in: the browser's region ("en-PH" → PH), else the United
 * States. Kept apart from the phone module so a page can call it without loading libphonenumber; the
 * phone field falls back to the United States for a region with no calling code.
 */
export function defaultPhoneCountry(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    if (region && /^[A-Z]{2}$/.test(region)) return region;
  } catch {
    // no navigator (server render) or an unusual locale
  }
  return 'US';
}
