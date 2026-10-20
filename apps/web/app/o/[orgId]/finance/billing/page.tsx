'use client';
import { useEffect, useMemo, useState } from 'react';
import { Info, Plus, Trash2 } from 'lucide-react';
import type { ClientDto, ProjectDto } from '@tallywork/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  PageHeader,
  Panel,
  PermissionState,
  Select,
  fmtDate,
  fmtMoney,
  useToast,
  type Column,
} from '@tallywork/ui';
import { useRouter } from 'next/navigation';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { todayIn, useOrg } from '@/lib/org';
import { toMinor, type RateKind, type RateRow, type RateScope } from '@/components/finance/types';
import { useMemberOptions } from '@/lib/members';
import { SCOPE_LABEL } from '@/components/finance/rate-precedence';
import { RATE_PRECEDENCE } from '@tallywork/domain';

// The order the billing engine applies (most specific first).
const PRECEDENCE: Record<RateKind, RateScope[]> = RATE_PRECEDENCE;

export default function RatesPage() {
  const org = useOrg();
  const router = useRouter();
  const canRates = org.can('rates:read');
  // What is owed to members moved to Payroll › Owed; people who came here for it are sent there.
  const owedOnly = !canRates && org.can('billing:read');
  useEffect(() => {
    if (owedOnly) router.replace(`${org.base}/finance/payroll?tab=owed`);
  }, [owedOnly, org.base, router]);

  if (owedOnly) return null;
  if (!canRates) return <PermissionState />;
  return (
    <>
      <PageHeader title="Rates" description="Hourly bill and pay rates: what you charge clients and what you pay members. What you owe members is on Payroll › Owed." />
      <RatesTab />
    </>
  );
}

// ─── Rates ───────────────────────────────────────────────────────────────────
function useTargets() {
  const org = useOrg();
  const clientsQ = useOrgQuery<ClientDto[]>('/clients?include_archived=true');
  const projectsQ = useOrgQuery<ProjectDto[]>('/projects?include_archived=true');
  const workersQ = useMemberOptions(org.can('members:read'));
  const names = useMemo(() => {
    const m = new Map<string, string>();
    clientsQ.data?.forEach((c) => m.set(c.id, c.name));
    projectsQ.data?.forEach((p) => m.set(p.id, p.name));
    workersQ.data?.forEach((w) => m.set(w.id, w.name));
    return m;
  }, [clientsQ.data, projectsQ.data, workersQ.data]);
  return { clients: clientsQ.data ?? [], projects: projectsQ.data ?? [], workers: workersQ.data ?? [], names };
}

function RatesTab() {
  const org = useOrg();
  const toast = useToast();
  const ratesQ = useOrgQuery<RateRow[]>('/rates');
  const targets = useTargets();
  const [dialog, setDialog] = useState<RateKind | null>(null);
  const [toDelete, setToDelete] = useState<RateRow | null>(null);
  const del = useOrgMutation<{ id: string }>('DELETE', (b) => `/rates/${b.id}`);
  const canManage = org.can('rates:manage');
  const today = todayIn(org.organization.timezone);

  const targetName = (r: RateRow): string => {
    if (r.scope === 'ORG') return 'Organization default';
    const id = r.scope_id ?? '';
    if (r.scope === 'PROJECT_WORKER') {
      const [p, w] = id.split(':');
      return `${targets.names.get(p ?? '') ?? 'Unknown project'} · ${targets.names.get(w ?? '') ?? 'Member'}`;
    }
    return targets.names.get(id) ?? (r.scope === 'WORKER' ? 'Member' : 'Unknown');
  };

  const columns: Column<RateRow>[] = [
    { key: 'scope', header: 'Applies to', cell: (r) => <Badge tone={r.scope === 'ORG' ? 'brand' : 'neutral'}>{SCOPE_LABEL[r.scope]}</Badge>, value: (r) => PRECEDENCE[r.kind].indexOf(r.scope), priority: 'secondary' },
    { key: 'target', header: 'Target', cell: (r) => <span className="font-medium">{targetName(r)}</span>, value: targetName, priority: 'primary' },
    { key: 'amount', header: 'Rate / hour', align: 'right', cell: (r) => fmtMoney(r.amount_minor, r.currency), value: (r) => r.amount_minor, priority: 'primary' },
    { key: 'from', header: 'Effective from', cell: (r) => fmtDate(r.effective_from), value: (r) => r.effective_from, priority: 'secondary' },
    { key: 'to', header: 'Until', cell: (r) => (r.effective_to ? fmtDate(r.effective_to) : <span className="text-text-faint">Open-ended</span>), value: (r) => r.effective_to ?? '9999' },
    {
      key: 'state',
      header: 'State',
      cell: (r) =>
        r.effective_from > today ? (
          <Badge tone="info">Scheduled</Badge>
        ) : r.effective_to && r.effective_to <= today ? (
          <Badge tone="neutral">Ended</Badge>
        ) : (
          <Badge tone="success">Current</Badge>
        ),
      value: (r) => (r.effective_from > today ? 1 : r.effective_to && r.effective_to <= today ? 2 : 0),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right' as const,
            cell: (r: RateRow) => (
              <IconButton label="Delete rate" size="xs" onClick={() => setToDelete(r)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            ),
          },
        ]
      : []),
  ];

  if (ratesQ.error) return <Panel><ErrorState error={ratesQ.error} onRetry={() => ratesQ.refetch()} /></Panel>;

  return (
    <div className="flex flex-col gap-4">
      {(['BILL', 'PAY'] as const).map((kind) => {
        const rows = (ratesQ.data ?? []).filter((r) => r.kind === kind);
        return (
          <Panel
            key={kind}
            title={kind === 'BILL' ? 'Bill rates (charged to clients)' : 'Pay rates (paid to members)'}
            actions={
              canManage && (
                <Button size="xs" icon={<Plus className="size-3.5" />} onClick={() => setDialog(kind)}>
                  Set {kind === 'BILL' ? 'bill' : 'pay'} rate
                </Button>
              )
            }
            footer={
              <span className="inline-flex items-start gap-1.5">
                <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>
                  The most specific rate wins: {PRECEDENCE[kind].map((s) => SCOPE_LABEL[s].toLowerCase()).join(' → ')}. Setting a new rate for the same target closes the previous one (history is kept).
                </span>
              </span>
            }
          >
            <DataTable
              rows={ratesQ.data ? rows : undefined}
              loading={ratesQ.isLoading}
              columns={columns}
              rowKey={(r) => r.id}
              initialSort={{ key: 'scope', dir: 'asc' }}
              empty={
                <EmptyState
                  title={`No ${kind === 'BILL' ? 'bill' : 'pay'} rates yet`}
                  description={kind === 'BILL' ? 'Set an organization default bill rate so billable time turns into invoiceable amounts.' : 'Set pay rates so approved time turns into amounts owed.'}
                  action={canManage && <Button size="sm" variant="primary" onClick={() => setDialog(kind)}>Set {kind === 'BILL' ? 'bill' : 'pay'} rate</Button>}
                />
              }
            />
          </Panel>
        );
      })}
      <SetRateDialog kind={dialog} onClose={() => setDialog(null)} targets={targets} />
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Delete rate?"
        description="Time already approved keeps its snapshotted amounts. Future calculations will fall back to the next matching rate."
        confirmLabel="Delete rate"
        danger
        loading={del.isPending}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await del.mutateAsync({ id: toDelete.id });
            toast.success('Rate deleted');
            setToDelete(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </div>
  );
}

interface RateBody {
  kind: RateKind;
  scope: RateScope;
  scope_id: string | null;
  amount_minor: number;
  currency: string;
  effective_from: string;
}

function SetRateDialog({ kind, onClose, targets }: { kind: RateKind | null; onClose: () => void; targets: ReturnType<typeof useTargets> }) {
  const org = useOrg();
  const toast = useToast();
  const [k, setK] = useState<RateKind>('BILL');
  const [scope, setScope] = useState<RateScope>('ORG');
  const [target, setTarget] = useState('');
  const [project, setProject] = useState('');
  const [worker, setWorker] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(org.organization.currency);
  const [from, setFrom] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const m = useOrgMutation<RateBody, RateRow[]>('POST', '/rates');

  useEffect(() => {
    if (!kind) return;
    setK(kind);
    setScope('ORG');
    setTarget('');
    setProject('');
    setWorker('');
    setAmount('');
    setCurrency(org.organization.currency);
    setFrom(todayIn(org.organization.timezone));
    setErr(null);
  }, [kind, org.organization.currency, org.organization.timezone]);

  const scopes = PRECEDENCE[k].slice().reverse();
  useEffect(() => {
    if (!PRECEDENCE[k].includes(scope)) setScope('ORG');
  }, [k, scope]);

  const scopeId = scope === 'ORG' ? null : scope === 'PROJECT_WORKER' ? (project && worker ? `${project}:${worker}` : '') : target;

  const submit = async () => {
    setErr(null);
    const minor = toMinor(amount);
    if (minor === null) {
      setErr(new ApiError(422, 'validation', 'Enter a valid amount', undefined, [{ field: 'amount_minor', message: 'Enter an amount like 75 or 75.50' }]));
      return;
    }
    if (scope !== 'ORG' && !scopeId) {
      setErr(new ApiError(422, 'validation', 'Choose a target', undefined, [{ field: 'scope_id', message: 'Choose who this rate applies to' }]));
      return;
    }
    try {
      await m.mutateAsync({ kind: k, scope, scope_id: scopeId, amount_minor: minor, currency: currency.toUpperCase(), effective_from: from });
      toast.success('Rate saved');
      onClose();
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    }
  };

  const workerOptions = targets.workers.filter((w) => w.status !== 'REMOVED');

  return (
    <Dialog
      open={!!kind}
      onOpenChange={(o) => !o && onClose()}
      title="Set rate"
      description="Creates a new rate version from the effective date. Earlier approved time keeps its amounts."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={m.isPending}>
            Save rate
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Kind" htmlFor="rate-kind">
          <Select id="rate-kind" value={k} onChange={(e) => setK(e.target.value as RateKind)}>
            <option value="BILL">Bill rate (client)</option>
            <option value="PAY">Pay rate (member)</option>
          </Select>
        </Field>
        <Field label="Applies to" htmlFor="rate-scope" error={err?.field('scope')}>
          <Select id="rate-scope" value={scope} onChange={(e) => (setScope(e.target.value as RateScope), setTarget(''))}>
            {scopes.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        {scope === 'CLIENT' && (
          <Field label="Client" htmlFor="rate-target" required className="sm:col-span-2" error={err?.field('scope_id')}>
            <Select id="rate-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose a client…</option>
              {targets.clients.filter((c) => !c.archived_at).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {(scope === 'PROJECT' || scope === 'PROJECT_WORKER') && (
          <Field label="Project" htmlFor="rate-project" required className={scope === 'PROJECT' ? 'sm:col-span-2' : undefined} error={err?.field('scope_id')}>
            <Select id="rate-project" value={scope === 'PROJECT' ? target : project} onChange={(e) => (scope === 'PROJECT' ? setTarget(e.target.value) : setProject(e.target.value))}>
              <option value="">Choose a project…</option>
              {targets.projects.filter((p) => !p.archived_at).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.client_name ? ` (${p.client_name})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {(scope === 'WORKER' || scope === 'PROJECT_WORKER') && (
          <Field label="Member" htmlFor="rate-worker" required className={scope === 'WORKER' ? 'sm:col-span-2' : undefined} error={scope === 'WORKER' ? err?.field('scope_id') : undefined}>
            <Select id="rate-worker" value={scope === 'WORKER' ? target : worker} onChange={(e) => (scope === 'WORKER' ? setTarget(e.target.value) : setWorker(e.target.value))}>
              <option value="">Choose a member…</option>
              {workerOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Rate per hour" htmlFor="rate-amount" required error={err?.field('amount_minor')}>
          <Input id="rate-amount" inputMode="decimal" className="tabular" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Currency" htmlFor="rate-currency" error={err?.field('currency')}>
          <Input id="rate-currency" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Effective from" htmlFor="rate-from" required error={err?.field('effective_from')}>
          <Input id="rate-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
      </div>
      {err && !err.errors?.length && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {err.title}
        </p>
      )}
    </Dialog>
  );
}
