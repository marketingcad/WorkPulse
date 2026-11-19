'use client';
import dynamic from 'next/dynamic';
import { Input } from '@tallywork/ui';
import { loadPhone } from '@/lib/phone-lazy';

export { defaultPhoneCountry } from '@/lib/phone-region';

export interface PhoneInputProps {
  id: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** A two-letter region, usually `defaultPhoneCountry()`; one with no calling code falls back to US. */
  defaultCountry?: string;
  placeholder?: string;
}

/**
 * A phone number field (country code list and the number in that country's format; see PhoneField).
 * The numbering plan data (libphonenumber) is about 30 KB gzipped, so the field and the phone module
 * load in their own chunk when a form shows one, not with every page that has a phone field; the
 * phone checks in those forms use the same module (`loadedPhone`). Until it is loaded, a disabled
 * field of the same size holds its place.
 */
export const PhoneInput = dynamic<PhoneInputProps>(() => loadPhone().then(() => import('./phone-field').then((m) => m.PhoneField)), {
  ssr: false,
  loading: () => (
    <div className="flex w-full gap-1.5" aria-busy="true">
      <span className="h-9 w-[4.75rem] shrink-0 rounded-sm border border-border bg-surface-muted" aria-hidden />
      <Input type="tel" disabled aria-label="Phone number (loading)" />
    </div>
  ),
});
