'use client';
import { useMemo, useRef, useState } from 'react';
import { Download, FileUp } from 'lucide-react';
import type { ManualTimeDto, TimeTypeDto } from '@tallywork/contracts';
import { Badge, Button, Dialog, Field, Input, cx, useToast } from '@tallywork/ui';
import { api, errorMessage, useOrgId, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { downloadText, parseCsv, toCsv } from '@/lib/csv';
import { HEADER, MAX_ROWS, toRows } from '@/lib/csv-import';
import { fromLocalInput, useAssignmentsFor } from './shared';
import { useQueryClient } from '@tanstack/react-query';

export function CsvImportDialog({ membershipId, onClose }: { membershipId: string; onClose: () => void }) {
  const org = useOrg();
  const orgId = useOrgId();
  const qc = useQueryClient();
  const toast = useToast();
  const isSelf = membershipId === org.membership.id;
  const { assignments } = useAssignmentsFor(membershipId);
  const input = useRef<HTMLInputElement>(null);
  const [cells, setCells] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [reason, setReason] = useState('Imported from CSV');
  const [results, setResults] = useState<Map<number, { ok: boolean; message: string }>>(new Map());
  const [busy, setBusy] = useState(false);
  const [readErr, setReadErr] = useState<string | null>(null);

  const typesQ = useOrgQuery<TimeTypeDto[]>('/time-types', { staleTime: 60_000 });
  const rows = useMemo(() => (cells && assignments && typesQ.data ? toRows(cells, assignments, typesQ.data).map((r) => ({ ...r, result: results.get(r.line) })) : []), [cells, assignments, typesQ.data, results]);
  const valid = rows.filter((r) => !r.error && !r.result?.ok);
  const done = results.size > 0;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setReadErr(null);
    setResults(new Map());
    if (file.size > 512 * 1024) return setReadErr('Use a file under 512 KB');
    const parsed = parseCsv(await file.text());
    if (parsed.length - 1 > MAX_ROWS) return setReadErr(`Import at most ${MAX_ROWS} rows at a time`);
    setFileName(file.name);
    setCells(parsed);
  };

  const run = async () => {
    setBusy(true);
    const next = new Map(results);
    for (const r of valid) {
      const s = fromLocalInput(`${r.date}T${r.start}`);
      const e = fromLocalInput(`${r.date}T${r.end}`);
      try {
        const res = await api<ManualTimeDto>(`/orgs/${orgId}/manual-time`, {
          method: 'POST',
          body: { membership_id: isSelf ? undefined : membershipId, project_id: r.projectId, task_id: r.taskId, started_at: s, ended_at: e, reason: reason.trim() || undefined, note: r.note || undefined, time_type_id: r.timeTypeId ?? undefined },
        });
        next.set(r.line, { ok: true, message: res.status === 'APPROVED' ? 'Added' : 'Requested' });
      } catch (x) {
        next.set(r.line, { ok: false, message: errorMessage(x) });
      }
      setResults(new Map(next));
    }
    await qc.invalidateQueries({ queryKey: ['org', orgId] });
    const ok = [...next.values()].filter((v) => v.ok).length;
    const failed = [...next.values()].filter((v) => !v.ok).length;
    if (ok) toast.success(`${ok} ${ok === 1 ? 'entry' : 'entries'} imported${failed ? `, ${failed} failed` : ''}`);
    else if (failed) toast.error('Nothing was imported');
    setBusy(false);
  };

  const template = () => downloadText('time-import-template.csv', toCsv(HEADER, [['2026-09-21', '09:00', '12:30', assignments?.[0]?.project_name ?? 'Project name', '', 'Client workshop', '']]));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title="Import time from CSV"
      description={`Columns: ${HEADER.join(', ')}. Times are in your browser's timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone}). Each row is added like manual time, so approval rules and limits apply.`}
      width={760}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          <Button variant="primary" loading={busy} disabled={!valid.length} onClick={run}>
            {valid.length ? `Import ${valid.length} ${valid.length === 1 ? 'row' : 'rows'}` : 'Import'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={<FileUp className="size-3.5" />} onClick={() => input.current?.click()} disabled={busy}>
            {fileName ? 'Choose another file' : 'Choose CSV file'}
          </Button>
          <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => (void pick(e.target.files?.[0]), (e.target.value = ''))} />
          {fileName && <span className="text-sm text-text-muted">{fileName}</span>}
          <Button variant="ghost" size="sm" icon={<Download className="size-3.5" />} onClick={template} className="ml-auto">
            Template
          </Button>
        </div>
        {readErr && (
          <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
            {readErr}
          </p>
        )}
        <Field label="Reason" htmlFor="csv-reason" hint="Recorded on every imported entry.">
          <Input id="csv-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {rows.length > 0 && (
          <div className="max-h-80 overflow-auto rounded-sm border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Rows to import</caption>
              <thead className="sticky top-0 bg-surface-muted text-left text-2xs uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-2 py-1.5">Line</th>
                  <th className="px-2 py-1.5">Date</th>
                  <th className="px-2 py-1.5">Time</th>
                  <th className="px-2 py-1.5">Project / task</th>
                  <th className="px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.line} className={cx(r.error && 'bg-danger-soft/40')}>
                    <td className="tabular px-2 py-1.5 text-text-muted">{r.line}</td>
                    <td className="tabular px-2 py-1.5">{r.date || '—'}</td>
                    <td className="tabular px-2 py-1.5">
                      {r.start}–{r.end}
                    </td>
                    <td className="max-w-64 truncate px-2 py-1.5">
                      {r.project}
                      {r.task && <span className="text-text-muted"> / {r.task}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {r.result ? <Badge tone={r.result.ok ? 'success' : 'danger'}>{r.result.message}</Badge> : r.error ? <span className="text-danger">{r.error}</span> : <span className="text-text-muted">Ready</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  );
}
