'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { BankDetailsDto, PayStubDto, PayrollProfileDto, PayrollRunDto } from '@tallywork/contracts';
import { Button, Dialog, Field, IconButton, Input, Select, Switch, Textarea, fmtMoney, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { MultiSelect } from '@/components/workspace/multi-select';
import { CURRENCIES } from '@/components/workspace/logo-editor';
import { fromMinor, toMinor } from './types';
import { useMemberOptions } from '@/lib/members';

type Period = PayrollProfileDto['period'];

export function periodLabel(p: Period): string {
  return { weekly: 'Weekly', biweekly: 'Every two weeks', semimonthly: 'Twice a month', monthly: 'Monthly' }[p.type];
}

// ─── Profile ─────────────────────────────────────────────────────────────────
export function PayrollProfileDialog({ profile, open, onOpenChange }: { profile: PayrollProfileDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const org = useOrg();
  const toast = useToast();
  const workersQ = useMemberOptions(open);
  const [f, setF] = useState({ name: '', type: 'monthly' as Period['type'], anchor: '', currency: org.organization.currency, isDefault: false, members: [] as string[] });
  const create = useOrgMutation<Record<string, unknown>, PayrollProfileDto>('POST', '/payroll/profiles');
  const update = useOrgMutation<Record<string, unknown>, PayrollProfileDto>('PATCH', () => `/payroll/profiles/${profile?.id}`);
  const m = profile ? update : create;
  const err = m.error instanceof ApiError ? m.error : null;

  useEffect(() => {
    if (!open) return;
    create.reset();
    update.reset();
    setF(
      profile
        ? { name: profile.name, type: profile.period.type, anchor: profile.period.type === 'biweekly' ? profile.period.anchorDate : '', currency: profile.currency, isDefault: profile.is_default, members: profile.members.map((x) => x.membership_id) }
        : { name: '', type: 'monthly', anchor: '', currency: org.organization.currency, isDefault: false, members: [] },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile]);

  const invalid = !f.name.trim() || (f.type === 'biweekly' && !f.anchor);
  const save = async () => {
    try {
      await m.mutateAsync({ name: f.name.trim(), period: f.type === 'biweekly' ? { type: 'biweekly', anchorDate: f.anchor } : { type: f.type }, currency: f.currency, is_default: f.isDefault, member_ids: f.members });
      toast.success(profile ? 'Pay group saved' : 'Pay group created');
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={profile ? 'Edit pay group' : 'New pay group'}
      description="A pay group: how often its members are paid, and in which currency. Each member can be in one pay group per currency."
      width={560}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="pp-form" variant="primary" disabled={invalid} loading={m.isPending}>
            {profile ? 'Save' : 'Create profile'}
          </Button>
        </>
      }
    >
      {err && !err.errors?.length && (
        <p role="alert" className="mb-3 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {err.title}
        </p>
      )}
      <form
        id="pp-form"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) void save();
        }}
      >
        <Field label="Name" htmlFor="pp-name" required error={err?.field('name')} className="sm:col-span-2">
          <Input id="pp-name" value={f.name} maxLength={100} placeholder="e.g. Monthly USD" onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Pay period" htmlFor="pp-period">
          <Select id="pp-period" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Period['type'] })}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Every two weeks</option>
            <option value="semimonthly">Twice a month (1st–15th, 16th–end)</option>
            <option value="monthly">Monthly</option>
          </Select>
        </Field>
        <Field label="Currency" htmlFor="pp-cur" error={err?.field('currency')}>
          <Select id="pp-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            {[...new Set([f.currency, ...CURRENCIES])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        {f.type === 'biweekly' && (
          <Field label="First day of a pay period" htmlFor="pp-anchor" required error={err?.field('period.anchorDate')}>
            <Input id="pp-anchor" type="date" value={f.anchor} onChange={(e) => setF({ ...f, anchor: e.target.value })} />
          </Field>
        )}
        <Field label="Members" htmlFor="pp-members" error={err?.field('member_ids')} className="sm:col-span-2">
          <MultiSelect id="pp-members" options={(workersQ.data ?? []).map((w) => ({ value: w.id, label: w.name }))} value={f.members} onChange={(members) => setF({ ...f, members })} placeholder="No members" />
        </Field>
        <div className="sm:col-span-2">
          <Switch checked={f.isDefault} onCheckedChange={(v) => setF({ ...f, isDefault: v })} label="Default pay group" description="Pre-selected when you run a payroll." />
        </div>
      </form>
    </Dialog>
  );
}

// ─── Bank details ────────────────────────────────────────────────────────────
const EMPTY_BANK: BankDetailsDto = { type: 'bank', bank_name: null, account_name: null, account_number: null, routing_number: null, iban: null, swift: null, notes: null };

export function BankDetailsDialog({ profileId, membershipId, name, currency, open, onOpenChange }: { profileId: string; membershipId: string; name: string; currency: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const q = useOrgQuery<BankDetailsDto | null>(open ? `/payroll/profiles/${profileId}/members/${membershipId}/bank` : null);
  const m = useOrgMutation<Record<string, unknown>, BankDetailsDto>('PUT', `/payroll/profiles/${profileId}/members/${membershipId}/bank`);
  const [f, setF] = useState<BankDetailsDto>(EMPTY_BANK);
  const err = m.error instanceof ApiError ? m.error : null;
  useEffect(() => {
    if (open && q.data !== undefined) setF(q.data ?? EMPTY_BANK);
  }, [open, q.data]);
  const set = (k: keyof BankDetailsDto, v: string) => setF({ ...f, [k]: v });
  const text = (k: keyof BankDetailsDto, label: string, max: number, extra: { placeholder?: string; className?: string; mono?: boolean } = {}) => (
    <Field label={label} htmlFor={`bk-${k}`} error={err?.field(k)} className={extra.className}>
      <Input id={`bk-${k}`} value={(f[k] as string | null) ?? ''} maxLength={max} placeholder={extra.placeholder} autoComplete="off" className={extra.mono ? 'font-mono' : undefined} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );

  const save = async () => {
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v]));
    try {
      await m.mutateAsync(body);
      toast.success('Bank details saved');
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Bank details · ${name}`}
      description={`Where ${currency} pay goes. Stored encrypted; only this member and payroll managers can see it.`}
      width={560}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={q.isLoading} onClick={save}>
            Save bank details
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Type" htmlFor="bk-type">
          <Select id="bk-type" value={f.type} onChange={(e) => set('type', e.target.value)}>
            <option value="bank">Bank transfer</option>
            <option value="wise">Wise</option>
            <option value="paypal">PayPal</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        {text('bank_name', f.type === 'bank' ? 'Bank name' : 'Provider', 150)}
        {text('account_name', 'Account holder', 150)}
        {text('account_number', f.type === 'paypal' ? 'PayPal email' : 'Account number', 64, { mono: true })}
        {f.type === 'bank' && (
          <>
            {text('routing_number', 'Routing / sort code', 64, { mono: true })}
            {text('swift', 'SWIFT / BIC', 20, { mono: true })}
            {text('iban', 'IBAN', 64, { mono: true, className: 'sm:col-span-2' })}
          </>
        )}
        <Field label="Notes" htmlFor="bk-notes" error={err?.field('notes')} className="sm:col-span-2">
          <Textarea id="bk-notes" value={f.notes ?? ''} maxLength={500} className="min-h-16" onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

// ─── Run payroll ─────────────────────────────────────────────────────────────
export function RunPayrollDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (r: PayrollRunDto) => void }) {
  const toast = useToast();
  const profilesQ = useOrgQuery<PayrollProfileDto[]>(open ? '/payroll/profiles' : null);
  const profiles = profilesQ.data ?? [];
  const [profileId, setProfileId] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const m = useOrgMutation<Record<string, unknown>, PayrollRunDto>('POST', '/payroll/runs');
  const err = m.error instanceof ApiError ? m.error : null;
  useEffect(() => {
    if (!open) return;
    m.reset();
    setDate('');
    setNotes('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const chosen = profileId || profiles.find((p) => p.is_default)?.id || profiles[0]?.id || '';

  const run = async () => {
    try {
      const r = await m.mutateAsync({ profile_id: chosen, date: date || undefined, notes: notes.trim() || undefined });
      toast.success(`Draft payroll for ${r.period_start} – ${r.period_end} created`);
      onCreated(r);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Run payroll"
      description="Creates a draft from approved time and paid time off. Review it, add bonuses or deductions, then finalize to publish pay stubs."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!chosen} onClick={run}>
            Create draft
          </Button>
        </>
      }
    >
      {profilesQ.data && !profiles.length ? (
        <p className="text-sm text-text-muted">Create a pay group first: it sets the pay period, the currency and who is paid.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {err && (
            <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
              {err.title}
            </p>
          )}
          <Field label="Pay group" htmlFor="rp-profile">
            <Select id="rp-profile" value={chosen} onChange={(e) => setProfileId(e.target.value)}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {periodLabel(p.period)} · {p.currency} · {p.members.length} {p.members.length === 1 ? 'member' : 'members'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Period" htmlFor="rp-date" hint="Any day in the period to pay. Empty = the last period that has ended.">
            <Input id="rp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="rp-notes">
            <Textarea id="rp-notes" value={notes} maxLength={1000} className="min-h-16" onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      )}
    </Dialog>
  );
}

// ─── Adjustments ─────────────────────────────────────────────────────────────
export function AdjustmentsDialog({ runId, line, onClose }: { runId: string; line: PayStubDto; onClose: () => void }) {
  const toast = useToast();
  const m = useOrgMutation<Record<string, unknown>, PayrollRunDto>('PUT', `/payroll/runs/${runId}/lines/${line.id}/adjustments`);
  const [rows, setRows] = useState(line.adjustments.map((a) => ({ label: a.label, amount: fromMinor(Math.abs(a.amount_minor)), sign: a.amount_minor < 0 ? -1 : 1 })));
  const parsed = rows.map((r) => ({ label: r.label.trim(), minor: toMinor(r.amount) }));
  const invalid = parsed.some((r) => !r.label || r.minor === null);
  const total = parsed.reduce((s, r, i) => s + (r.minor ?? 0) * rows[i]!.sign, 0);

  const save = async () => {
    try {
      await m.mutateAsync({ adjustments: parsed.map((r, i) => ({ label: r.label, amount_minor: (r.minor ?? 0) * rows[i]!.sign })) });
      toast.success('Adjustments saved');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Bonuses and deductions · ${line.name}`}
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={invalid} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[110px_1fr_110px_auto] items-end gap-2">
            <Field label={i === 0 ? 'Kind' : ''} htmlFor={`adj-s-${i}`}>
              <Select id={`adj-s-${i}`} value={r.sign} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, sign: Number(e.target.value) } : x)))}>
                <option value={1}>Bonus</option>
                <option value={-1}>Deduction</option>
              </Select>
            </Field>
            <Field label={i === 0 ? 'Label' : ''} htmlFor={`adj-l-${i}`}>
              <Input id={`adj-l-${i}`} value={r.label} maxLength={100} placeholder="e.g. Performance bonus" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            </Field>
            <Field label={i === 0 ? `Amount (${line.currency})` : ''} htmlFor={`adj-a-${i}`}>
              <Input id={`adj-a-${i}`} inputMode="decimal" className="tabular" value={r.amount} placeholder="0.00" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
            </Field>
            <IconButton label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        ))}
        <div className="flex items-center justify-between pt-1">
          <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setRows([...rows, { label: '', amount: '', sign: 1 }])} disabled={rows.length >= 20}>
            Add line
          </Button>
          <span className="text-sm text-text-muted">
            Net after adjustments: <span className="tabular font-semibold text-text">{fmtMoney(line.gross_minor + total, line.currency)}</span>
          </span>
        </div>
      </div>
    </Dialog>
  );
}
