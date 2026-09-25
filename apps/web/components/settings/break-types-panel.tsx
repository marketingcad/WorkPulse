'use client';
import { useEffect, useState } from 'react';
import { Archive, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { Badge, Button, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, Field, IconButton, Input, Menu, MenuItem, Panel, Switch, useToast, type Column } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';

export interface BreakTypeItem {
  id: string;
  name: string;
  paid: boolean;
  max_minutes: number | null;
}
interface BreakTypeBody {
  name: string;
  paid: boolean;
  max_minutes: number | null;
}

export function BreakTypesPanel() {
  const toast = useToast();
  const q = useOrgQuery<BreakTypeItem[]>('/break-types');
  const [edit, setEdit] = useState<BreakTypeItem | 'new' | null>(null);
  const [archive, setArchive] = useState<BreakTypeItem | null>(null);
  const del = useOrgMutation<{ id: string }>('DELETE', (b) => `/break-types/${b.id}`);

  const columns: Column<BreakTypeItem>[] = [
    {
      key: 'name',
      header: 'Name',
      priority: 'primary',
      value: (b) => b.name,
      cell: (b) => <span className="font-medium">{b.name}</span>,
    },
    {
      key: 'paid',
      header: 'Pay',
      priority: 'secondary',
      value: (b) => (b.paid ? 1 : 0),
      cell: (b) => (b.paid ? <Badge tone="success">Paid</Badge> : <Badge>Unpaid</Badge>),
    },
    {
      key: 'max',
      header: 'Max length',
      align: 'right',
      priority: 'secondary',
      value: (b) => b.max_minutes ?? Infinity,
      cell: (b) => <span className="tabular text-text-muted">{b.max_minutes === null ? 'No limit' : `${b.max_minutes} min`}</span>,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (b) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Menu
            trigger={
              <IconButton label={`Actions for ${b.name}`} size="xs">
                <MoreHorizontal className="size-3.5" />
              </IconButton>
            }
          >
            <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => setEdit(b)}>
              Edit
            </MenuItem>
            <MenuItem icon={<Archive className="size-3.5" />} danger onSelect={() => setArchive(b)}>
              Archive
            </MenuItem>
          </Menu>
        </span>
      ),
    },
  ];

  return (
    <Panel
      title="Break types"
      actions={
        <Button size="xs" icon={<Plus className="size-3" />} onClick={() => setEdit('new')}>
          Add break type
        </Button>
      }
    >
      <p className="border-b border-border px-4 py-3 text-sm text-text-muted">People can pick a break type when they pause the web timer, so breaks are labelled in their sessions.</p>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          columns={columns}
          rowKey={(b) => b.id}
          onRowClick={(b) => setEdit(b)}
          caption="Break types"
          initialSort={{ key: 'name', dir: 'asc' }}
          empty={<EmptyState title="No break types" description="Add types such as Lunch or Rest so people can label their breaks." action={<Button onClick={() => setEdit('new')}>Add break type</Button>} />}
        />
      )}

      <BreakTypeDialog item={edit === 'new' ? null : edit} open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} />
      <ConfirmDialog
        open={!!archive}
        onOpenChange={(o) => !o && setArchive(null)}
        title={`Archive ${archive?.name ?? 'break type'}?`}
        description="It can no longer be picked when pausing. Breaks already recorded with it are kept."
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

function BreakTypeDialog({ item, open, onOpenChange }: { item: BreakTypeItem | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', paid: false, max: '' });
  const create = useOrgMutation<BreakTypeBody, BreakTypeItem>('POST', '/break-types');
  const update = useOrgMutation<BreakTypeBody, BreakTypeItem>('PUT', () => `/break-types/${item?.id}`);
  const m = item ? update : create;
  const err = m.error instanceof ApiError ? m.error : null;

  useEffect(() => {
    if (!open) return;
    create.reset();
    update.reset();
    setF(
      item
        ? {
            name: item.name,
            paid: item.paid,
            max: item.max_minutes === null ? '' : String(item.max_minutes),
          }
        : { name: '', paid: false, max: '' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  const maxNum = Number(f.max);
  const maxErr = f.max.trim() !== '' && (!Number.isInteger(maxNum) || maxNum < 1 || maxNum > 1440) ? 'Whole minutes between 1 and 1440' : undefined;
  const invalid = !f.name.trim() || f.name.trim().length > 60 || !!maxErr;

  const save = async () => {
    try {
      await m.mutateAsync({
        name: f.name.trim(),
        paid: f.paid,
        max_minutes: f.max.trim() === '' ? null : maxNum,
      });
      toast.success(item ? 'Break type updated' : 'Break type added');
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? 'Edit break type' : 'New break type'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="break-type-form" variant="primary" disabled={invalid} loading={m.isPending}>
            {item ? 'Save' : 'Add break type'}
          </Button>
        </>
      }
    >
      <form
        id="break-type-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) void save();
        }}
      >
        <Field label="Name" htmlFor="bt-name" error={err?.field('name')} required>
          <Input id="bt-name" value={f.name} maxLength={60} placeholder="e.g. Lunch" onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Switch checked={f.paid} onCheckedChange={(v) => setF({ ...f, paid: v })} label="Paid break" description="Mark breaks your organization pays for, such as short rest breaks." />
        <Field label="Maximum length (minutes)" htmlFor="bt-max" hint="Leave empty for no limit." error={err?.field('max_minutes') ?? maxErr}>
          <Input id="bt-max" type="number" min={1} max={1440} step={1} inputMode="numeric" className="tabular" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
        </Field>
      </form>
    </Dialog>
  );
}
