'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Input, Popover, cx } from '@tallywork/ui';
import { callingCode, countryOptions, flag, formatNational, isCountryCode, phoneParts, type CountryCode } from '@tallywork/contracts/phone';
import { phoneValue } from '@/lib/phone';
import type { PhoneInputProps } from './phone-input';

/**
 * A phone number: a searchable country code list and the number in that country's format (form
 * validation audit, 20 Nov 2026). `value` is what is stored (E.164, or older free text, shown as it is
 * to be corrected); `onChange` gets what to send (see `phoneValue`). Check it with `phoneProblem`.
 * Loaded on demand by `PhoneInput` (./phone-input), with the numbering plan data.
 */
export function PhoneField({ id, value, onChange, disabled, defaultCountry, placeholder }: PhoneInputProps) {
  // The browser's region may be one with no calling code (Antarctica): then the United States.
  const fallback: CountryCode = isCountryCode(defaultCountry) ? defaultCountry : 'US';
  const initial = useMemo(() => phoneParts(value, fallback), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [country, setCountry] = useState<CountryCode>(initial.country);
  const [national, setNational] = useState(initial.national);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const emitted = useRef(value ?? '');
  const options = useMemo(() => countryOptions(), []);

  // A new value from outside (the form was reset or saved): show it.
  useEffect(() => {
    if ((value ?? '') === emitted.current) return;
    emitted.current = value ?? '';
    const parts = phoneParts(value, fallback);
    setCountry(parts.country);
    setNational(parts.national);
  }, [value, fallback]);

  const emit = (c: CountryCode, n: string) => {
    const v = phoneValue(c, n);
    emitted.current = v;
    onChange(v);
  };

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase().replace(/^\+/, '');
    if (!n) return options;
    return options.filter((o) => o.name.toLowerCase().includes(n) || o.code.toLowerCase() === n || o.calling.slice(1).startsWith(n));
  }, [options, q]);
  const current = options.find((o) => o.code === country);

  const trigger = (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Country code: ${current?.name ?? country} ${callingCode(country)}`}
      className="flex h-9 shrink-0 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-sm transition-colors hover:border-border-strong focus:border-interactive focus:outline-none focus:ring-2 focus:ring-interactive/20 disabled:bg-surface-muted disabled:text-text-muted"
    >
      <span aria-hidden>{flag(country)}</span>
      <span className="tabular">{callingCode(country)}</span>
      <ChevronDown className="size-3.5 text-text-faint" aria-hidden />
    </button>
  );

  return (
    <div className="flex w-full gap-1.5">
      {disabled ? (
        trigger
      ) : (
        <Popover
          trigger={trigger}
          className="w-72 p-0"
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setQ('');
          }}
        >
          <label className="relative flex items-center border-b border-border">
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-text-faint" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search countries or codes"
              aria-label="Search countries"
              className="h-9 w-full bg-transparent pl-8 pr-2 text-sm focus:outline-none"
              autoFocus
            />
          </label>
          <ul className="max-h-64 overflow-y-auto p-1" role="listbox" aria-label="Countries">
            {shown.length === 0 ? (
              <li className="px-2 py-3 text-center text-sm text-text-muted">No matches</li>
            ) : (
              shown.map((o) => (
                <li key={o.code} role="option" aria-selected={o.code === country}>
                  <button
                    type="button"
                    className={cx('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface-muted focus:bg-surface-muted focus:outline-none', o.code === country && 'font-semibold')}
                    onClick={() => {
                      setCountry(o.code);
                      setOpen(false);
                      setQ('');
                      const n = formatNational(national, o.code);
                      setNational(n);
                      emit(o.code, n);
                    }}
                  >
                    <span aria-hidden>{o.flag}</span>
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                    <span className="tabular text-text-muted">{o.calling}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </Popover>
      )}
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        maxLength={30}
        placeholder={placeholder}
        disabled={disabled}
        value={national}
        onChange={(e) => {
          const n = e.target.value;
          setNational(n);
          emit(country, n);
        }}
        onBlur={() => {
          // A typed or pasted international number picks its own country; a national one is formatted.
          const typed = national.trim();
          if (typed.startsWith('+')) {
            const parts = phoneParts(typed, country);
            if (parts.national !== typed) {
              setCountry(parts.country);
              setNational(parts.national);
              emit(parts.country, parts.national);
            }
            return;
          }
          const n = formatNational(national, country);
          if (n !== national) {
            setNational(n);
            emit(country, n);
          }
        }}
      />
    </div>
  );
}
