'use client';
import { useEffect, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Field, IconButton, Input, SegmentedControl, cx, fmtMoney } from '@tallywork/ui';
import { useOrg } from '@/lib/org';
import { asHm } from '@/lib/duration';
import { convertHours, payFor, shiftSeconds, totalShiftSeconds, type PayInput, type Shift } from './math';

export type Mode = 'hours' | 'pay' | 'convert';
export const EMPTY_SHIFT: Shift = { start: '', end: '', breakText: '' };

/**
 * The calculator's three modes, loaded when the panel first opens (the button is on every page; this
 * is not). What was typed is held by the launcher, so it stays when the panel closes.
 */
export default function CalculatorBody(p: {
  mode: Mode;
  onMode: (m: Mode) => void;
  shifts: Shift[];
  onShifts: (s: Shift[]) => void;
  pay: PayInput;
  onPay: (v: PayInput) => void;
  convert: string;
  onConvert: (v: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  // The first field takes focus when the panel opens and when the mode changes.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('input')?.focus();
  }, [p.mode]);
  const useTotalInPay = () => {
    p.onPay({ ...p.pay, hours: asHm(totalShiftSeconds(p.shifts)) });
    p.onMode('pay');
  };
  return (
    <div ref={root} className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
      <SegmentedControl
        label="What to work out"
        value={p.mode}
        onChange={p.onMode}
        options={[
          { value: 'hours', label: 'Hours' },
          { value: 'pay', label: 'Pay' },
          { value: 'convert', label: 'Convert' },
        ]}
      />
      {p.mode === 'hours' && <HoursCalc shifts={p.shifts} onChange={p.onShifts} onUseInPay={useTotalInPay} />}
      {p.mode === 'pay' && <PayCalc value={p.pay} onChange={p.onPay} />}
      {p.mode === 'convert' && <ConvertCalc value={p.convert} onChange={p.onConvert} />}
    </div>
  );
}

function Result({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'danger' }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={cx('tabular-nums', strong ? 'text-base font-semibold text-text' : 'text-sm text-text', tone === 'danger' && 'text-danger')}>{value}</dd>
    </div>
  );
}

function HoursCalc({ shifts, onChange, onUseInPay }: { shifts: Shift[]; onChange: (s: Shift[]) => void; onUseInPay: () => void }) {
  const set = (i: number, patch: Partial<Shift>) => onChange(shifts.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const total = totalShiftSeconds(shifts);
  return (
    <div className="flex flex-col gap-3">
      {shifts.map((s, i) => {
        const r = shiftSeconds(s);
        const err = r.kind === 'error' ? r : null;
        const n = shifts.length > 1 ? ` ${i + 1}` : '';
        return (
          <fieldset key={i} aria-label={`Shift${n}`} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text">Shift{n}</span>
              {shifts.length > 1 && (
                <IconButton label={`Remove shift${n}`} size="xs" onClick={() => onChange(shifts.filter((_, j) => j !== i))}>
                  <X className="size-3.5" />
                </IconButton>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Start" htmlFor={`calc-start-${i}`}>
                <Input id={`calc-start-${i}`} type="time" value={s.start} onChange={(e) => set(i, { start: e.target.value })} aria-invalid={err?.field === 'start'} />
              </Field>
              <Field label="End" htmlFor={`calc-end-${i}`}>
                <Input id={`calc-end-${i}`} type="time" value={s.end} onChange={(e) => set(i, { end: e.target.value })} aria-invalid={err?.field === 'end'} />
              </Field>
              <Field label="Break" htmlFor={`calc-break-${i}`}>
                <Input id={`calc-break-${i}`} inputMode="decimal" placeholder="0:30" value={s.breakText} onChange={(e) => set(i, { breakText: e.target.value })} aria-invalid={err?.field === 'break'} />
              </Field>
            </div>
            {err ? (
              <p role="alert" className="text-xs text-danger">
                {err.message}
              </p>
            ) : r.kind === 'ok' ? (
              <p className="text-xs text-text-muted">
                <span className="tabular-nums font-semibold text-text">{asHm(r.seconds)}</span> worked{r.overnight ? ', past midnight' : ''}
              </p>
            ) : null}
          </fieldset>
        );
      })}
      <Button size="xs" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange([...shifts, EMPTY_SHIFT])} className="self-start">
        Add shift
      </Button>
      <dl className="flex flex-col gap-1 border-t border-border pt-3" aria-live="polite">
        <Result label="Total worked" value={asHm(total)} strong />
        <Result label="In decimal hours" value={(total / 3600).toFixed(2)} />
      </dl>
      <Button size="sm" variant="secondary" disabled={total === 0} onClick={onUseInPay}>
        Work out pay for these hours
      </Button>
    </div>
  );
}

function PayCalc({ value, onChange }: { value: { hours: string; payRate: string; billRate: string }; onChange: (v: { hours: string; payRate: string; billRate: string }) => void }) {
  const org = useOrg();
  const cur = org.organization.currency;
  const r = payFor(value);
  const money = (m: number | null) => (m === null ? '—' : fmtMoney(m, cur));
  return (
    <div className="flex flex-col gap-3">
      <Field label="Hours" htmlFor="calc-pay-hours" error={r.errors.hours} hint="7:30, 7h 30m or 7.5">
        <Input id="calc-pay-hours" inputMode="decimal" placeholder="7:30" value={value.hours} onChange={(e) => onChange({ ...value, hours: e.target.value })} aria-invalid={!!r.errors.hours} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={`Pay rate per hour (${cur})`} htmlFor="calc-pay-rate" error={r.errors.payRate}>
          <Input id="calc-pay-rate" inputMode="decimal" placeholder="25.00" value={value.payRate} onChange={(e) => onChange({ ...value, payRate: e.target.value })} aria-invalid={!!r.errors.payRate} />
        </Field>
        <Field label={`Bill rate per hour (${cur})`} htmlFor="calc-bill-rate" error={r.errors.billRate}>
          <Input id="calc-bill-rate" inputMode="decimal" placeholder="60.00" value={value.billRate} onChange={(e) => onChange({ ...value, billRate: e.target.value })} aria-invalid={!!r.errors.billRate} />
        </Field>
      </div>
      <dl className="flex flex-col gap-1 border-t border-border pt-3" aria-live="polite">
        <Result label="Pay" value={money(r.payMinor)} strong />
        <Result label="Bill" value={money(r.billMinor)} />
        <Result label="Margin" value={money(r.marginMinor)} tone={r.marginMinor !== null && r.marginMinor < 0 ? 'danger' : undefined} />
      </dl>
      <p className="text-xs text-text-faint">Rounded to the cent like payroll. Payroll rounds each time entry, so a real pay run can differ by a few cents. WorkPulse adds no overtime premium.</p>
    </div>
  );
}

function ConvertCalc({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const r = convertHours(value);
  return (
    <div className="flex flex-col gap-3">
      <Field label="Hours" htmlFor="calc-convert" error={r.kind === 'error' ? r.message : null} hint="Type 7:45, 7h 45m, 7.75 or 465m">
        <Input id="calc-convert" inputMode="decimal" placeholder="7:45" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={r.kind === 'error'} />
      </Field>
      <dl className="flex flex-col gap-1 border-t border-border pt-3" aria-live="polite">
        <Result label="Hours and minutes" value={r.kind === 'ok' ? r.hm : '—'} strong />
        <Result label="Decimal hours" value={r.kind === 'ok' ? r.decimal : '—'} />
        <Result label="Minutes" value={r.kind === 'ok' ? String(r.minutes) : '—'} />
      </dl>
    </div>
  );
}
