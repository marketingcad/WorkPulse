'use client';
import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Sheet } from 'lucide-react';
import { Button, Menu, MenuItem, MenuLabel, useToast } from '@tallywork/ui';
import { errorMessage, useOrgId } from '@/lib/api';
import { downloadExport } from './download';

/**
 * Export what a list page shows as CSV, Excel or PDF, through the report of the same data, so
 * the file matches the report and is recorded like any other export. Needs a period: with
 * "Any date" chosen the button says so instead of exporting everything.
 */
export function ExportMenu({ reportKey, from, to, status, label = 'Export', caption }: { reportKey: string; from: string; to: string; status?: string; label?: string; /** what the file covers, when not the period (e.g. "Status today") */ caption?: string }) {
  const orgId = useOrgId();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ready = !!from && !!to;
  const run = async (format: 'CSV' | 'XLSX' | 'PDF') => {
    setBusy(true);
    try {
      await downloadExport(`/orgs/${orgId}/reports/${reportKey}/export`, { format, from, to, ...(status ? { status } : {}) }, `${reportKey}_${from}_${to}.${format.toLowerCase()}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  if (!ready)
    return (
      <Button icon={<Download className="size-3.5" />} disabled title="Pick a period to export">
        {label}
      </Button>
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
