'use client';
import { useEffect, useState } from 'react';
import { Archive, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import type { TimeTypeDto } from '@tallywork/contracts';
import { Badge, Button, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, Field, IconButton, Input, Menu, MenuItem, Panel, Switch, useToast, type Column } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { ColorPicker } from '@/components/workspace/shared';

interface TimeTypeBody {
  name: string;
  short_name: string;
  color: string;
  pay_coefficient: number;
  bill_coefficient: number;
  not_billable: boolean;
  is_default: boolean;
}

const times = (n: number) => `${Number(n.toFixed(3))}×`;

export function TimeTypeBadge({ type }: { type: Pick<TimeTypeDto, 'short_name' | 'name' | 'color'> }) {
  return (
    <span title={type.name} className="inline-flex h-5 items-center rounded-sm px-1.5 text-2xs font-semibold text-white" style={{ background: type.color }}>
      {type.short_name}
    </span>
  );
}

export function TimeTypesPanel() {
  const toast = useToast();
  const q = useOrgQuery<TimeTypeDto[]>('/time-types');
  const [edit, setEdit] = useState<TimeTypeDto | 'new' | null>(null);
  const [archive, setArchive] = useState<TimeTypeDto | null>(null);
  const del = useOrgMutation<{ id: string }>('DELETE', (b) => `/time-types/${b.id}`);

  const columns: Column<TimeTypeDto>[] = [
    {
      key: 'name',
      header: 'Name',
      priority: 'primary',
      value: (t) => t.name,
      cell: (t) => (
        <span className="flex items-center gap-2">
          <TimeTypeBadge type={t} />
          <span className="font-medium">{t.name}</span>
          {t.is_default && <Badge tone="brand">Default</Badge>}
        </span>
      ),
    },
    { key: 'pay', header: 'Pay rate', align: 'right', priority: 'secondary', value: (t) => t.pay_coefficient, cell: (t) => <span className="tabular">{times(t.pay_coefficient)}</span> },
    { key: 'bill', header: 'Bill rate', align: 'right', value: (t) => t.bill_coefficient, cell: (t) => (t.not_billable ? <Badge>Not billable</Badge> : <span className="tabular">{times(t.bill_coefficient)}</span>) },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (t) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Menu
            trigger={
              <IconButton label={`Actions for ${t.name}`} size="xs">
                <MoreHorizontal className="size-3.5" />
              </IconButton>
            }
          >
            <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setEdit(t)}>
              Edit
            </MenuItem>
            <MenuItem icon={<Archive className="size-3.5" />} danger onSelect={() => setArchive(t)}>
              Archive
            </MenuItem>
          </Menu>
        </span>
      ),
    },
  ];

  return (
    <Panel
      title="Time types"
      actions={
        <Button size="xs" icon={<Plus className="size-3" />} onClick={() => setEdit('new')}>
          Add time type
        </Button>
      }
    >
      <p className="border-b border-border px-4 py-3 text-sm text-text-muted">
        Label time as Normal, Overtime and so on. The multipliers apply to pay and billable rates, for example 1.5× pay for overtime. Time without a type uses the default type, or 1×.
      </p>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          columns={columns}
          rowKey={(t) => t.id}
          onRowClick={(t) => setEdit(t)}
          caption="Time types"
          empty={<EmptyState title="No time types" description="All time is paid and billed at 1× the rate." action={<Button onClick={() => setEdit('new')}>Add time type</Button>} />}
        />
      )}

      <TimeTypeDialog item={edit === 'new' ? null : edit} open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} />
      <ConfirmDialog
        open={!!archive}
        onOpenChange={(o) => !o && setArchive(null)}
        title={`Archive ${archive?.name ?? 'time type'}?`}
        description="It can no longer be picked. Time already labelled with it keeps its multipliers."
        confirmLabel="Archive"
        danger
        loading={del.isPending}
        onConfirm={async () => {
          if (!archive) return;
          try {
            await del.mutateAsync({ id: archive.id });
            toast.success(`${archive.name} archived`);
            setArchive(null);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </Panel>
  );
}

function TimeTypeDialog({ item, open, onOpenChange }: { item: TimeTypeDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', short: '', color: '#475569', pay: '1', bill: '1', notBillable: false, isDefault: false });
  const create = useOrgMutation<TimeTypeBody, TimeTypeDto>('POST', '/time-types');
  const update = useOrgMutation<TimeTypeBody, TimeTypeDto>('PATCH', () => `/time-types/${item?.id}`);
  const m = item ? update : create;
  const err = m.error instanceof ApiError ? m.error : null;

  useEffect(() => {
    if (!open) return;
    create.reset();
    update.reset();
    setF(
      item
        ? { name: item.name, short: item.short_name, color: item.color, pay: String(item.pay_coefficient), bill: String(item.bill_coefficient), notBillable: item.not_billable, isDefault: item.is_default }
        : { name: '', short: '', color: '#475569', pay: '1', bill: '1', notBillable: false, isDefault: false },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const coefErr = (v: string) => (!(num(v) >= 0 && num(v) <= 10) ? 'A number from 0 to 10' : undefined);
  const invalid = !f.name.trim() || !f.short.trim() || !!coefErr(f.pay) || (!f.notBillable && !!coefErr(f.bill));

  const save = async () => {
    try {
      await m.mutateAsync({ name: f.name.trim(), short_name: f.short.trim(), color: f.color, pay_coefficient: num(f.pay), bill_coefficient: f.notBillable ? 0 : num(f.bill), not_billable: f.notBillable, is_default: f.isDefault });
      toast.success(item ? 'Time type updated' : 'Time type added');
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? 'Edit time type' : 'New time type'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="time-type-form" variant="primary" disabled={invalid} loading={m.isPending}>
            {item ? 'Save' : 'Add time type'}
          </Button>
        </>
      }
    >
      <form
        id="time-type-form"
        className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_120px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) void save();
        }}
      >
        <Field label="Name" htmlFor="tt-name" error={err?.field('name')} required>
          <Input id="tt-name" value={f.name} maxLength={60} placeholder="e.g. Overtime" onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Short name" htmlFor="tt-short" error={err?.field('short_name')} required>
          <Input id="tt-short" value={f.short} maxLength={4} placeholder="OT" onChange={(e) => setF({ ...f, short: e.target.value })} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2">
          <Field label="Pay rate multiplier" htmlFor="tt-pay" hint="1 = the normal rate, 1.5 = time and a half." error={err?.field('pay_coefficient') ?? coefErr(f.pay)}>
            <Input id="tt-pay" type="number" min={0} max={10} step={0.05} inputMode="decimal" className="tabular" value={f.pay} onChange={(e) => setF({ ...f, pay: e.target.value })} />
          </Field>
          <Field label="Bill rate multiplier" htmlFor="tt-bill" hint="Applied to the bill rate." error={err?.field('bill_coefficient') ?? (f.notBillable ? undefined : coefErr(f.bill))}>
            <Input id="tt-bill" type="number" min={0} max={10} step={0.05} inputMode="decimal" className="tabular" value={f.notBillable ? '0' : f.bill} disabled={f.notBillable} onChange={(e) => setF({ ...f, bill: e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-col gap-3 sm:col-span-2">
          <Switch checked={f.notBillable} onCheckedChange={(v) => setF({ ...f, notBillable: v })} label="Never billable" description="Time of this type is always non-billable, such as training." />
          <Switch checked={f.isDefault} onCheckedChange={(v) => setF({ ...f, isDefault: v })} label="Default type" description="Used for time without a type, including tracked time." />
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-muted">Tag colour</span>
            <ColorPicker label="Time type colour" value={f.color} onChange={(color) => setF({ ...f, color })} />
          </div>
        </div>
      </form>
    </Dialog>
  );
}
