'use client';
import { useEffect, useState } from 'react';
import type { BudgetStatusDto, ClientDto, ProjectDto } from '@tallywork/contracts';
import { Button, Checkbox, Dialog, Field, Input, Select, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { fromMinor, toMinor } from './types';

interface BudgetBody {
  subject_type: 'PROJECT' | 'CLIENT';
  subject_id: string;
  kind: 'HOURS' | 'MONEY';
  amount: number;
  period: 'TOTAL' | 'MONTHLY';
  warn_pct: number;
  include_non_billable: boolean;
}

/**
 * Create or edit a project/client budget. `preset` fixes the subject (e.g. from a project page).
 */
export function BudgetDialog({ value, onClose, preset }: { value: BudgetStatusDto | 'new' | null; onClose: () => void; preset?: { type: 'PROJECT' | 'CLIENT'; id: string; name: string } }) {
  const org = useOrg();
  const toast = useToast();
  const open = value !== null;
  const existing = value && value !== 'new' ? value : null;
  const projectsQ = useOrgQuery<ProjectDto[]>(open && !preset ? '/projects' : null);
  const clientsQ = useOrgQuery<ClientDto[]>(open && !preset ? '/clients' : null);
  const [subjectType, setSubjectType] = useState<'PROJECT' | 'CLIENT'>('PROJECT');
  const [subjectId, setSubjectId] = useState('');
  const [kind, setKind] = useState<'HOURS' | 'MONEY'>('HOURS');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<'TOTAL' | 'MONTHLY'>('TOTAL');
  const [warn, setWarn] = useState('80');
  const [nonBillable, setNonBillable] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const m = useOrgMutation<BudgetBody, BudgetStatusDto[]>('PUT', '/budgets');
  // A subject has one budget: setting a new one replaces it, which is said before saving (U8).
  const budgetsQ = useOrgQuery<BudgetStatusDto[]>(open && !existing ? '/budgets' : null);
  const replacing = !existing && subjectId ? budgetsQ.data?.find((b) => b.subject_type === subjectType && b.subject_id === subjectId) : undefined;

  useEffect(() => {
    if (!open) return;
    setErr(null);
    if (existing) {
      setPeriod(existing.period);
      setWarn(String(existing.warn_pct));
      setNonBillable(existing.include_non_billable);
      setSubjectType(existing.subject_type);
      setSubjectId(existing.subject_id);
      setKind(existing.kind);
      setAmount(existing.kind === 'HOURS' ? String(Math.round((existing.amount / 3600) * 100) / 100) : fromMinor(existing.amount));
    } else {
      setSubjectType(preset?.type ?? 'PROJECT');
      setSubjectId(preset?.id ?? '');
      setKind('HOURS');
      setAmount('');
      setPeriod('TOTAL');
      setWarn('80');
      setNonBillable(false);
    }
    // Only reset when the dialog opens or the edited budget changes, not on background refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);

  const submit = async () => {
    setErr(null);
    let amt: number | null = null;
    if (kind === 'HOURS') {
      const h = Number(amount.trim());
      amt = amount.trim() && Number.isFinite(h) && h > 0 ? Math.round(h * 3600) : null;
    } else amt = toMinor(amount);
    if (!amt || amt < 1) {
      setErr(new ApiError(422, 'validation', 'Enter an amount', undefined, [{ field: 'amount', message: kind === 'HOURS' ? 'Enter a number of hours, e.g. 120 or 37.5' : 'Enter an amount, e.g. 5000' }]));
      return;
    }
    if (!subjectId) {
      setErr(new ApiError(422, 'validation', 'Choose a subject', undefined, [{ field: 'subject_id', message: `Choose a ${subjectType === 'PROJECT' ? 'project' : 'client'}` }]));
      return;
    }
    const w = Number(warn);
    try {
      await m.mutateAsync({ subject_type: subjectType, subject_id: subjectId, kind, amount: amt, period, warn_pct: Number.isInteger(w) ? w : 80, include_non_billable: nonBillable });
      toast.success('Budget saved');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={existing ? `Edit budget · ${existing.subject_name}` : 'Set budget'}
      description="Each project or client has at most one budget; saving replaces the existing one."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={m.isPending}>
            Save budget
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Budget for" htmlFor="b-type">
          <Select id="b-type" value={subjectType} disabled={!!existing || !!preset} onChange={(e) => (setSubjectType(e.target.value as 'PROJECT' | 'CLIENT'), setSubjectId(''))}>
            <option value="PROJECT">Project</option>
            <option value="CLIENT">Client</option>
          </Select>
        </Field>
        <Field label={subjectType === 'PROJECT' ? 'Project' : 'Client'} htmlFor="b-subject" required error={err?.field('subject_id')}>
          <Select id="b-subject" value={subjectId} disabled={!!existing || !!preset} onChange={(e) => setSubjectId(e.target.value)}>
            <option value="">Choose…</option>
            {existing && <option value={existing.subject_id}>{existing.subject_name}</option>}
            {!existing && preset && <option value={preset.id}>{preset.name}</option>}
            {subjectType === 'PROJECT'
              ? projectsQ.data?.filter((p) => p.id !== existing?.subject_id && p.id !== preset?.id).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.client_name ? ` (${p.client_name})` : ''}
                  </option>
                ))
              : clientsQ.data?.filter((c) => c.id !== existing?.subject_id && c.id !== preset?.id).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
          </Select>
          {replacing && (
            <p role="note" className="mt-1 text-xs text-warning">
              {replacing.subject_name} already has a budget. Saving replaces it.
            </p>
          )}
        </Field>
        <Field label="Type" htmlFor="b-kind">
          <Select id="b-kind" value={kind} onChange={(e) => (setKind(e.target.value as 'HOURS' | 'MONEY'), setAmount(''))}>
            <option value="HOURS">Hours</option>
            <option value="MONEY">Money (bill amount)</option>
          </Select>
        </Field>
        <Field label={kind === 'HOURS' ? 'Hours' : `Amount (${org.organization.currency})`} htmlFor="b-amount" required error={err?.field('amount')}>
          <Input id="b-amount" inputMode="decimal" className="tabular" placeholder={kind === 'HOURS' ? '120' : '5000.00'} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Period" htmlFor="b-period">
          <Select id="b-period" value={period} onChange={(e) => setPeriod(e.target.value as 'TOTAL' | 'MONTHLY')}>
            <option value="TOTAL">Total (lifetime)</option>
            <option value="MONTHLY">Monthly (resets each month)</option>
          </Select>
        </Field>
        <Field label="Warn at (%)" htmlFor="b-warn" hint="Managers are notified when usage crosses this level and at 100%." error={err?.field('warn_pct')}>
          <Input id="b-warn" type="number" min={1} max={100} className="tabular" value={warn} onChange={(e) => setWarn(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox label="Include non-billable time" checked={nonBillable} onChange={(e) => setNonBillable(e.target.checked)} />
        </div>
      </div>
      {err && !err.errors?.length && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {err.title}
        </p>
      )}
    </Dialog>
  );
}
