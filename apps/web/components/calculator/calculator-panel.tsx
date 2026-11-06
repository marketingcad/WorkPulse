'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Minus, Plus, X } from 'lucide-react';
import { Button, Field, IconButton, Input, SegmentedControl, cx, fmtMoney, fmtPct } from '@tallywork/ui';
import { useOrg } from '@/lib/org';
import { t } from '@/lib/i18n';
import { asHm } from '@/lib/duration';
import { fromMinor } from '../finance/types';
import { convertHours, decimalHours, lineSeconds, payFor, shiftSeconds, signedHm, sumDurations, totalShiftSeconds, type DurationLine, type PayInput, type Shift } from './math';
import { EMPTY_LINE, EMPTY_SHIFT, clearMode, modeIsEmpty, type CalcState, type Mode } from './state';

const MODES: Mode[] = ['hours', 'sum', 'pay', 'convert'];

/**
 * The calculator's body: four modes, each with its main answer first and the others under it, every
 * answer copyable. Loaded the first time the calculator opens (see calculator-launcher.tsx).
 */
export function CalculatorPanel({ state, onChange }: { state: CalcState; onChange: (next: CalcState) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<CalcState>) => onChange({ ...state, ...patch });

  // Opening, or switching mode, puts the cursor in the first field.
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[data-calc-body] input')?.focus();
  }, [state.mode]);

  const useInPay = (seconds: number) => onChange({ ...state, mode: 'pay', pay: { ...state.pay, hours: asHm(seconds) } });

  return (
    <div ref={root} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <SegmentedControl label={t('calc.modeLabel')} value={state.mode} onChange={(mode) => set({ mode })} options={MODES.map((m) => ({ value: m, label: t(`calc.mode.${m}`) }))} />
        <Button size="xs" variant="ghost" aria-label={t('calc.clearLabel', { mode: t(`calc.mode.${state.mode}`) })} disabled={modeIsEmpty(state)} onClick={() => onChange(clearMode(state))}>
          {t('calc.clear')}
        </Button>
      </div>
      <div data-calc-body className="flex flex-col gap-3">
        {state.mode === 'hours' && <HoursCalc shifts={state.shifts} onChange={(shifts) => set({ shifts })} onUseInPay={useInPay} />}
        {state.mode === 'sum' && <SumCalc lines={state.lines} onChange={(lines) => set({ lines })} onUseInPay={useInPay} />}
        {state.mode === 'pay' && <PayCalc value={state.pay} onChange={(pay) => set({ pay })} />}
        {state.mode === 'convert' && <ConvertCalc value={state.convert} onChange={(convert) => set({ convert })} />}
      </div>
    </div>
  );
}

/** Copies one answer; a check mark confirms it (and Answers tells screen readers). */
function CopyValue({ label, value, onCopied }: { label: string; value: string | null; onCopied: (label: string) => void }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(id);
  }, [done]);
  // Nothing to copy yet: keep the space so the figures do not shift when one appears.
  if (value === null) return <span className="size-6 shrink-0" aria-hidden />;
  return (
    <IconButton
      label={t('calc.copy', { label })}
      size="xs"
      className="shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          onCopied(label);
        } catch {
          /* clipboard unavailable: the figure stays selectable */
        }
      }}
    >
      {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </IconButton>
  );
}

interface Answer {
  label: string;
  /** what is shown; '—' when there is nothing to show yet */
  shown: string;
  /** what Copy puts on the clipboard (a plain number, ready to paste into a field); null hides Copy */
  copy: string | null;
  tone?: 'danger';
}

/** The main answer, large, then the others. Each is a term and its value, so they read as pairs. */
function Answers({ main, rest, footer }: { main: Answer; rest: Answer[]; footer?: ReactNode }) {
  const [copied, setCopied] = useState('');
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <dl className="flex flex-col gap-1.5" aria-live="polite">
        <div className="flex flex-col gap-0.5 rounded-md bg-surface-muted px-3 py-2">
          <dt className="text-xs text-text-muted">{main.label}</dt>
          <dd className="flex items-center justify-between gap-2">
            <span className={cx('min-w-0 truncate text-2xl font-semibold tabular-nums leading-tight text-text', main.tone === 'danger' && 'text-danger')}>{main.shown}</span>
            <CopyValue label={main.label} value={main.copy} onCopied={setCopied} />
          </dd>
        </div>
        {rest.map((a) => (
          <div key={a.label} className="flex items-center gap-2 pl-3">
            <dt className="flex-1 text-xs text-text-muted">{a.label}</dt>
            <dd className="flex items-center gap-2">
              <span className={cx('text-sm tabular-nums text-text', a.tone === 'danger' && 'text-danger')}>{a.shown}</span>
              <CopyValue label={a.label} value={a.copy} onCopied={setCopied} />
            </dd>
          </div>
        ))}
      </dl>
      <span role="status" className="sr-only">
        {copied ? t('calc.copied', { label: copied }) : ''}
      </span>
      {footer}
    </div>
  );
}

const hoursAnswers = (seconds: number, totalLabel: string): { main: Answer; rest: Answer[] } => ({
  main: { label: totalLabel, shown: signedHm(seconds), copy: signedHm(seconds) },
  rest: [{ label: t('calc.inDecimal'), shown: decimalHours(seconds), copy: decimalHours(seconds) }],
});

function HoursCalc({ shifts, onChange, onUseInPay }: { shifts: Shift[]; onChange: (s: Shift[]) => void; onUseInPay: (seconds: number) => void }) {
  const set = (i: number, patch: Partial<Shift>) => onChange(shifts.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const total = totalShiftSeconds(shifts);
  return (
    <>
      {shifts.map((s, i) => {
        const r = shiftSeconds(s);
        const err = r.kind === 'error' ? r : null;
        const name = shifts.length > 1 ? t('calc.shiftN', { n: i + 1 }) : t('calc.shift');
        return (
          <fieldset key={i} aria-label={name} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex h-6 items-center justify-between">
              <span className="text-xs font-semibold text-text">{name}</span>
              {shifts.length > 1 && (
                <IconButton label={t('calc.removeShift', { n: i + 1 })} size="xs" onClick={() => onChange(shifts.filter((_, j) => j !== i))}>
                  <X className="size-3.5" />
                </IconButton>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label={t('calc.start')} htmlFor={`calc-start-${i}`}>
                <Input id={`calc-start-${i}`} type="time" value={s.start} onChange={(e) => set(i, { start: e.target.value })} aria-invalid={err?.field === 'start'} />
              </Field>
              <Field label={t('calc.end')} htmlFor={`calc-end-${i}`}>
                <Input id={`calc-end-${i}`} type="time" value={s.end} onChange={(e) => set(i, { end: e.target.value })} aria-invalid={err?.field === 'end'} />
              </Field>
              <Field label={t('calc.break')} htmlFor={`calc-break-${i}`}>
                <Input id={`calc-break-${i}`} inputMode="decimal" placeholder="0:30" value={s.breakText} onChange={(e) => set(i, { breakText: e.target.value })} aria-invalid={err?.field === 'break'} />
              </Field>
            </div>
            {err ? (
              <p role="alert" className="text-xs text-danger">
                {t(err.message)}
              </p>
            ) : r.kind === 'ok' ? (
              <p className="text-xs tabular-nums text-text-muted">{t(r.overnight ? 'calc.workedOvernight' : 'calc.worked', { time: asHm(r.seconds) })}</p>
            ) : null}
          </fieldset>
        );
      })}
      <Button size="xs" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange([...shifts, EMPTY_SHIFT])} className="self-start">
        {t('calc.addShift')}
      </Button>
      <Answers
        {...hoursAnswers(total, t('calc.totalWorked'))}
        footer={
          <Button size="sm" variant="secondary" disabled={total <= 0} onClick={() => onUseInPay(total)}>
            {t('calc.useInPay')}
          </Button>
        }
      />
    </>
  );
}

function SumCalc({ lines, onChange, onUseInPay }: { lines: DurationLine[]; onChange: (l: DurationLine[]) => void; onUseInPay: (seconds: number) => void }) {
  const set = (i: number, patch: Partial<DurationLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = sumDurations(lines);
  return (
    <>
      <p className="text-xs text-text-muted">{t('calc.sum.intro')}</p>
      <ul className="flex flex-col gap-2">
        {lines.map((l, i) => {
          const n = i + 1;
          const r = lineSeconds(l);
          const errorId = `calc-line-${i}-error`;
          return (
            <li key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  square
                  aria-label={t(l.op === '+' ? 'calc.sum.adds' : 'calc.sum.subtracts', { n })}
                  onClick={() => set(i, { op: l.op === '+' ? '-' : '+' })}
                  className={cx('shrink-0', l.op === '-' && 'text-danger')}
                >
                  {l.op === '+' ? <Plus className="size-3.5" /> : <Minus className="size-3.5" />}
                </Button>
                <Input
                  aria-label={t('calc.sum.line', { n })}
                  inputMode="decimal"
                  placeholder="7:30"
                  value={l.text}
                  onChange={(e) => set(i, { text: e.target.value })}
                  aria-invalid={r.kind === 'error'}
                  aria-describedby={r.kind === 'error' ? errorId : undefined}
                />
                {lines.length > 1 ? (
                  <IconButton label={t('calc.sum.remove', { n })} size="xs" className="shrink-0" onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                    <X className="size-3.5" />
                  </IconButton>
                ) : (
                  <span className="size-6 shrink-0" aria-hidden />
                )}
              </div>
              {r.kind === 'error' && (
                <p id={errorId} role="alert" className="pl-10 text-xs text-danger">
                  {t(r.message)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <Button size="xs" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange([...lines, EMPTY_LINE])} className="self-start">
        {t('calc.sum.addLine')}
      </Button>
      <Answers
        {...hoursAnswers(total, t('calc.sum.total'))}
        footer={
          <Button size="sm" variant="secondary" disabled={total <= 0} onClick={() => onUseInPay(total)}>
            {t('calc.useInPay')}
          </Button>
        }
      />
    </>
  );
}

function PayCalc({ value, onChange }: { value: PayInput; onChange: (v: PayInput) => void }) {
  const org = useOrg();
  const currency = org.organization.currency;
  const r = payFor(value);
  const money = (label: string, m: number | null, tone?: 'danger'): Answer => ({ label, shown: m === null ? '—' : fmtMoney(m, currency), copy: m === null ? null : fromMinor(m), tone });
  const pct = (label: string, v: number | null): Answer => ({ label, shown: fmtPct(v), copy: v === null ? null : String(Math.round(v)) });
  const negative = r.marginMinor !== null && r.marginMinor < 0 ? 'danger' : undefined;
  return (
    <>
      <Field label={t('calc.pay.hours')} htmlFor="calc-pay-hours" error={r.errors.hours ? t(r.errors.hours) : null} hint={t('calc.pay.hoursHint')}>
        <Input id="calc-pay-hours" inputMode="decimal" placeholder="7:30" value={value.hours} onChange={(e) => onChange({ ...value, hours: e.target.value })} aria-invalid={!!r.errors.hours} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('calc.pay.payRate', { currency })} htmlFor="calc-pay-rate" error={r.errors.payRate ? t(r.errors.payRate) : null}>
          <Input id="calc-pay-rate" inputMode="decimal" placeholder="25.00" value={value.payRate} onChange={(e) => onChange({ ...value, payRate: e.target.value })} aria-invalid={!!r.errors.payRate} />
        </Field>
        <Field label={t('calc.pay.billRate', { currency })} htmlFor="calc-bill-rate" error={r.errors.billRate ? t(r.errors.billRate) : null}>
          <Input id="calc-bill-rate" inputMode="decimal" placeholder="60.00" value={value.billRate} onChange={(e) => onChange({ ...value, billRate: e.target.value })} aria-invalid={!!r.errors.billRate} />
        </Field>
      </div>
      <Answers
        main={money(t('calc.pay.pay'), r.payMinor)}
        rest={[
          money(t('calc.pay.bill'), r.billMinor),
          money(t('calc.pay.margin'), r.marginMinor, negative),
          { ...pct(t('calc.pay.marginPct'), r.marginPct), tone: negative },
          { ...pct(t('calc.pay.markupPct'), r.markupPct), tone: negative },
        ]}
        footer={<p className="text-xs text-text-faint">{t('calc.pay.note')}</p>}
      />
    </>
  );
}

function ConvertCalc({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const r = convertHours(value);
  const ok = r.kind === 'ok' ? r : null;
  return (
    <>
      <Field label={t('calc.convert.hours')} htmlFor="calc-convert" error={r.kind === 'error' ? t(r.message) : null} hint={t('calc.convert.hint')}>
        <Input id="calc-convert" inputMode="decimal" placeholder="7:45" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={r.kind === 'error'} />
      </Field>
      <Answers
        main={{ label: t('calc.convert.hm'), shown: ok?.hm ?? '—', copy: ok?.hm ?? null }}
        rest={[
          { label: t('calc.convert.decimal'), shown: ok?.decimal ?? '—', copy: ok?.decimal ?? null },
          { label: t('calc.convert.minutes'), shown: ok ? String(ok.minutes) : '—', copy: ok ? String(ok.minutes) : null },
        ]}
      />
    </>
  );
}
