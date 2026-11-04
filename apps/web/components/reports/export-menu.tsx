'use client';
import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Sheet } from 'lucide-react';
import { Button, Menu, MenuItem, MenuLabel, Popover, useToast } from '@tallywork/ui';
import { errorMessage, useOrgId } from '@/lib/api';
import { downloadExport } from './download';

/**
 * Export what a list page shows as CSV, Excel or PDF, through the report of the same data, so
 * the file matches the report and is recorded like any other export. Needs a period: with
 * "Any date" chosen the button says so instead of exporting everything.
 */
export function ExportMenu({ reportKey, from, to, status, filters, label = 'Export', caption }: {
  reportKey: string;
  from: string;
  to: string;
  status?: string;
  /** more of the list's filters for the file to match (report parameters, e.g. client_ids, q) */
  filters?: Record<string, unknown>;
  label?: string;
  /** what the file covers, when not the period (e.g. "Status today") */
  caption?: string;
}) {
  const orgId = useOrgId();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ready = !!from && !!to;
  const run = async (format: 'CSV' | 'XLSX' | 'PDF') => {
    setBusy(true);
    try {
      await downloadExport(`/orgs/${orgId}/reports/${reportKey}/export`, { format, from, to, ...(status ? { status } : {}), ...filters }, `${reportKey}_${from}_${to}.${format.toLowerCase()}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  // Not a disabled button with a hover tip (nothing explains it on a phone or to a keyboard):
  // it opens a note that says what to do.
  if (!ready)
    return (
      <Popover
        align="end"
        className="max-w-64"
        trigger={
          <Button icon={<Download className="size-3.5" />}>
            {label}
          </Button>
        }
      >
        <p role="note" className="text-sm text-text-muted">
          Choose a period first. An export covers one period, so “Any date” cannot be exported.
        </p>
      </Popover>
    );
  return (
    <Menu
      trigger={
        <Button icon={<Download className="size-3.5" />} loading={busy}>
          {label}
        </Button>
      }
    >
      <MenuLabel>{caption ?? `${from} – ${to}`}</MenuLabel>
      <MenuItem icon={<Sheet className="size-3.5" />} onSelect={() => run('CSV')}>
        CSV
      </MenuItem>
      <MenuItem icon={<FileSpreadsheet className="size-3.5" />} onSelect={() => run('XLSX')}>
        Excel (XLSX)
      </MenuItem>
      <MenuItem icon={<FileText className="size-3.5" />} onSelect={() => run('PDF')}>
        PDF
      </MenuItem>
    </Menu>
  );
}
