'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText, Save, Sheet, X } from 'lucide-react';
import type { ClientDto, ProjectDto, TeamDto, WorkerDto } from '@tallywork/contracts';
import {
  Button,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FilterBar,
  Input,
  KpiStrip,
  Menu,
  MenuItem,
  PageHeader,
  Panel,
  PermissionState,
  Select,
  SkeletonRows,
  Spinner,
  cx,
  fmtDate,
  useToast,
  type Column,
} from '@tallywork/ui';
import { ApiError, api, errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { ColumnChart } from '@/components/charts';
import { DateRangeFilter, isPreset, rangeFor, type Preset } from '@/components/reports/date-range';
import { MultiSelect } from '@/components/reports/multi-select';
import { NUMERIC_TYPES, formatCell, formatValue, type CatalogItem, type ColumnType, type FormatCtx, type ReportResult, type SavedReport } from '@/components/reports/format';
import { downloadExport } from '@/components/reports/download';

type Billable = 'all' | 'billable' | 'non_billable';
interface Params {
  from: string;
  to: string;
  membership_ids: string[];
  team_ids: string[];
  project_ids: string[];
  client_ids: string[];
  group_by: string[];
  billable: Billable;
}

const GROUP_LABEL: Record<string, string> = { worker: 'Member', project: 'Project', task: 'Task', client: 'Client', date: 'Date', week: 'Week' };

export default function ReportRunnerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <ReportRunner />
    </Suspense>
  );
}

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function ReportRunner() {
  const org = useOrg();
  const toast = useToast();
  const { key, orgId } = useParams<{ key: string; orgId: string }>();
  const search = useSearchParams();
  const savedId = search.get('saved');
  const tz = org.organization.timezone;
  const ws = org.organization.week_start;

  const catalogQ = useOrgQuery<CatalogItem[]>('/reports');
  const savedQ = useOrgQuery<SavedReport[]>(savedId ? '/saved-reports' : null);
  const item = catalogQ.data?.find((r) => r.key === key);
  const manager = org.isManagerView;
  const workersQ = useOrgQuery<WorkerDto[]>(manager ? '/workers' : null);
  const teamsQ = useOrgQuery<TeamDto[]>(manager ? '/teams' : null);
  const projectsQ = useOrgQuery<ProjectDto[]>('/projects');
  const clientsQ = useOrgQuery<ClientDto[]>(org.can('clients:read') ? '/clients' : null);

  const [preset, setPreset] = useState<Preset>('this_week');
  const [params, setParams] = useState<Params>(() => ({ ...rangeFor('this_week', tz, ws), membership_ids: [], team_ids: [], project_ids: [], client_ids: [], group_by: [], billable: 'all' }));
  const [savedName, setSavedName] = useState<string | null>(null);
  const applied = useRef(false);
  const [ready, setReady] = useState(!savedId);

  // Default grouping for reports that support it.
  useEffect(() => {
    if (item?.groupings.length && !savedId && params.group_by.length === 0) setParams((p) => ({ ...p, group_by: item.groupings.slice(0, 2) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.key]);

  // Preload params from ?saved=ID once.
  useEffect(() => {
    if (!savedId || applied.current || !savedQ.data) return;
    applied.current = true;
    const s = savedQ.data.find((x) => x.id === savedId);
    if (s) {
      const p = s.params;
      const pr = isPreset(p.preset) ? p.preset : 'custom';
      const range = pr !== 'custom' ? rangeFor(pr, tz, ws) : { from: typeof p.from === 'string' ? p.from : params.from, to: typeof p.to === 'string' ? p.to : params.to };
      setPreset(pr);
      setParams({
        ...range,
        membership_ids: strArr(p.membership_ids),
        team_ids: strArr(p.team_ids),
        project_ids: strArr(p.project_ids),
        client_ids: strArr(p.client_ids),
        group_by: strArr(p.group_by).slice(0, 3),
        billable: p.billable === 'billable' || p.billable === 'non_billable' ? p.billable : 'all',
      });
      setSavedName(s.name);
    } else toast.error('That saved report no longer exists');
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedId, savedQ.data]);
  useEffect(() => {
    if (savedQ.error) setReady(true);
  }, [savedQ.error]);

  const body = useMemo(() => {
    const b: Record<string, unknown> = { from: params.from, to: params.to, billable: params.billable };
    if (params.membership_ids.length) b.membership_ids = params.membership_ids;
    if (params.team_ids.length) b.team_ids = params.team_ids;
    if (params.project_ids.length) b.project_ids = params.project_ids;
    if (params.client_ids.length) b.client_ids = params.client_ids;
    if (item?.groupings.length && params.group_by.length) b.group_by = params.group_by;
    return b;
  }, [params, item?.groupings.length]);

  const validRange = params.from <= params.to && (Date.parse(params.to) - Date.parse(params.from)) / 86_400_000 <= 400;
  const resultQ = useQuery<ReportResult, ApiError>({
    queryKey: ['org', orgId, 'report', key, body],
    queryFn: ({ signal }) => api<ReportResult>(`/orgs/${orgId}/reports/${key}/query`, { method: 'POST', body, signal }),
    enabled: !!item && ready && validRange,
    placeholderData: (prev) => prev,
  });
  const result = resultQ.data;

  const f: FormatCtx = { fmtDuration: org.fmtDuration, currency: result?.currency ?? org.organization.currency, timeZone: org.membership.timezone };

  const [exporting, setExporting] = useState<string | null>(null);
  const doExport = async (format: 'CSV' | 'XLSX' | 'PDF') => {
    setExporting(format);
    try {
      await downloadExport(`/orgs/${orgId}/reports/${key}/export`, { format, ...body }, `${key}_${params.from}_${params.to}.${format.toLowerCase()}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(null);
    }
  };

  const [saveOpen, setSaveOpen] = useState(false);

  const set = <K extends keyof Params>(k: K, v: Params[K]) => setParams((p) => ({ ...p, [k]: v }));
  const toggleGroup = (g: string) =>
    setParams((p) => {
      if (p.group_by.includes(g)) return { ...p, group_by: p.group_by.filter((x) => x !== g) };
      if (p.group_by.length >= 3) return p;
      return { ...p, group_by: [...p.group_by, g] };
    });

  const columns = useMemo<Column<Record<string, string | number | null>>[]>(
    () =>
      (result?.columns ?? []).map((c, i) => ({
        key: c.key,
        header: c.label,
        cell: (r) => formatCell(c.type, r[c.key], f),
        value: (r) => r[c.key] ?? null,
        align: NUMERIC_TYPES.includes(c.type) ? 'right' : undefined,
        priority: i === 0 ? 'primary' : i < 3 ? 'secondary' : 'low',
        className: c.type === 'text' && i === 0 ? 'font-medium' : undefined,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, org.fmtDuration],
  );
  const rows = useMemo(() => (result?.rows ?? []).map((r, i) => ({ ...r, __i: i })), [result]);

  if (catalogQ.isLoading)
    return (
      <Panel>
        <SkeletonRows />
      </Panel>
    );
  if (catalogQ.error) return <ErrorState error={catalogQ.error} onRetry={() => catalogQ.refetch()} />;
  if (!item) return <PermissionState message="This report does not exist or your role cannot run it." />;

  const chart = result?.chart;
  const chartType: ColumnType = chart ? (result!.columns.find((c) => c.key === chart.series[0]?.key)?.type ?? (result!.columns.some((c) => c.type === 'duration') ? 'duration' : result!.columns.some((c) => c.type === 'money') ? 'money' : 'number')) : 'number';
  const xIsDate = chart ? chart.x === 'date' || result!.columns.find((c) => c.key === chart.x)?.type === 'date' : false;
  const hasTotals = !!result?.totals && Object.keys(result.totals).length > 0;
  const filtersActive = params.membership_ids.length + params.team_ids.length + params.project_ids.length + params.client_ids.length > 0 || params.billable !== 'all';

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href={`${org.base}/reports`} className="hover:underline">
            Reports
          </Link>
        }
        title={savedName ?? item.title}
        description={savedName ? `${item.title} · ${item.question}` : item.question}
        actions={
          <>
            <Button icon={<Save className="size-3.5" />} onClick={() => setSaveOpen(true)}>
              Save report
            </Button>
            <Menu
              trigger={
                <Button variant="primary" icon={<Download className="size-3.5" />} loading={!!exporting} disabled={!result}>
                  Export
                </Button>
              }
            >
              <MenuItem icon={<Sheet className="size-3.5" />} onSelect={() => doExport('CSV')}>
                CSV
              </MenuItem>
              <MenuItem icon={<FileSpreadsheet className="size-3.5" />} onSelect={() => doExport('XLSX')}>
                Excel (XLSX)
              </MenuItem>
              <MenuItem icon={<FileText className="size-3.5" />} onSelect={() => doExport('PDF')}>
                PDF
              </MenuItem>
            </Menu>
          </>
        }
      />

      <FilterBar>
        <DateRangeFilter
          preset={preset}
          from={params.from}
          to={params.to}
          tz={tz}
          weekStart={ws}
          onChange={(v) => {
            setPreset(v.preset);
            setParams((p) => ({ ...p, from: v.from, to: v.to }));
          }}
        />
        {manager && <MultiSelect label="Members" options={(workersQ.data ?? []).map((w) => ({ value: w.id, label: w.name }))} value={params.membership_ids} onChange={(v) => set('membership_ids', v)} loading={workersQ.isLoading} />}
        {manager && (teamsQ.data?.length ?? 0) > 0 && <MultiSelect label="Teams" options={(teamsQ.data ?? []).filter((t) => !t.archived_at).map((t) => ({ value: t.id, label: t.name }))} value={params.team_ids} onChange={(v) => set('team_ids', v)} />}
        {(projectsQ.data?.length ?? 0) > 0 && <MultiSelect label="Projects" options={(projectsQ.data ?? []).map((p) => ({ value: p.id, label: p.name, sub: p.client_name ?? undefined }))} value={params.project_ids} onChange={(v) => set('project_ids', v)} />}
        {(clientsQ.data?.length ?? 0) > 0 && <MultiSelect label="Clients" options={(clientsQ.data ?? []).map((c) => ({ value: c.id, label: c.name }))} value={params.client_ids} onChange={(v) => set('client_ids', v)} />}
        <Select aria-label="Billable" className="w-52" value={params.billable} onChange={(e) => set('billable', e.target.value as Billable)}>
          <option value="all">Billable + non-billable</option>
          <option value="billable">Billable only</option>
          <option value="non_billable">Non-billable only</option>
        </Select>
        {filtersActive && (
          <Button variant="ghost" size="sm" icon={<X className="size-3.5" />} onClick={() => setParams((p) => ({ ...p, membership_ids: [], team_ids: [], project_ids: [], client_ids: [], billable: 'all' }))}>
            Clear filters
          </Button>
        )}
        {resultQ.isFetching && <Spinner />}
      </FilterBar>

      {item.groupings.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Group by">
          <span className="text-xs font-medium text-text-muted">Group by</span>
          {item.groupings.map((g) => {
            const idx = params.group_by.indexOf(g);
            const on = idx >= 0;
            const disabled = !on && params.group_by.length >= 3;
            return (
              <button
                key={g}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => toggleGroup(g)}
                className={cx(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  on ? 'border-secondary bg-secondary-soft text-secondary' : 'border-border bg-surface text-text-muted hover:border-border-strong hover:text-text',
                )}
              >
                {on && <span className="tabular inline-flex size-4 items-center justify-center rounded-full bg-secondary text-2xs text-white">{idx + 1}</span>}
                {GROUP_LABEL[g] ?? g}
              </button>
            );
          })}
          <span className="text-xs text-text-faint">Up to 3, in the order you pick them.</span>
        </div>
      )}

      {!validRange ? (
        <Panel>
          <EmptyState title="Choose a valid date range" description="The start must be on or before the end, and ranges are limited to 400 days." />
        </Panel>
      ) : resultQ.error ? (
        <Panel>
          <ErrorState error={resultQ.error} onRetry={() => resultQ.refetch()} />
        </Panel>
      ) : !result ? (
        <Panel>
          <SkeletonRows rows={8} />
        </Panel>
      ) : (
        <div className={cx('flex flex-col gap-4 transition-opacity', resultQ.isFetching && 'opacity-70')}>
          {result.summary.length > 0 && <KpiStrip items={result.summary.map((s) => ({ label: s.label, value: formatValue(s.type, s.value, f) }))} />}
          {chart && chart.data.length > 0 && chart.series.length > 0 && (
            <Panel title={xIsDate ? (chart.series.length > 1 ? 'Per day' : `${chart.series[0]?.label ?? ''} per day`) : `${chart.series[0]?.label ?? ''} by ${(result.columns.find((c) => c.key === chart.x)?.label ?? chart.x).toLowerCase()}`}>
              <div className="p-4">
                <ColumnChart data={chart.data} x={chart.x} series={chart.series} format={(v) => formatValue(chartType, v, f)} xFormat={xIsDate ? (v) => fmtDate(v, { month: 'short', day: 'numeric' }) : undefined} />
              </div>
            </Panel>
          )}
          <Panel title={`${result.rows.length.toLocaleString()} ${result.rows.length === 1 ? 'row' : 'rows'}`}>
            <DataTable
              caption={item.title}
              rows={rows}
              columns={columns}
              rowKey={(r) => String(r.__i)}
              searchable={result.rows.length > 10}
              empty={<EmptyState title="No data for these filters" description="Try a wider date range or clear some filters." />}
              footer={
                hasTotals ? (
                  <tr className="h-10">
                    {result.columns.map((c, i) => {
                      const v = result.totals![c.key];
                      return (
                        <td key={c.key} className={cx('px-3 py-1.5', NUMERIC_TYPES.includes(c.type) && 'tabular text-right')}>
                          {i === 0 ? 'Total' : v !== undefined ? formatValue(c.type, v, f) : ''}
                        </td>
                      );
                    })}
                  </tr>
                ) : undefined
              }
            />
          </Panel>
        </div>
      )}

      <SaveDialog open={saveOpen} onOpenChange={setSaveOpen} reportKey={key} defaultName={savedName ?? item.title} params={{ ...body, preset, group_by: params.group_by }} />
    </>
  );
}

function SaveDialog({ open, onOpenChange, reportKey, defaultName, params }: { open: boolean; onOpenChange: (o: boolean) => void; reportKey: string; defaultName: string; params: Record<string, unknown> }) {
  const toast = useToast();
  const [name, setName] = useState(defaultName);
  const [shared, setShared] = useState(false);
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);
  const m = useOrgMutation<{ report_key: string; name: string; params: Record<string, unknown>; shared: boolean }, { id: string }>('POST', '/saved-reports', {
    onSuccess: () => {
      toast.success('Report saved');
      onOpenChange(false);
    },
  });
  const err = m.error instanceof ApiError ? m.error : null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Save report"
      description="Saves the current filters. Relative ranges like “This week” stay relative."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!name.trim()} onClick={() => m.mutate({ report_key: reportKey, name: name.trim(), params, shared })}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) m.mutate({ report_key: reportKey, name: name.trim(), params, shared });
        }}
      >
        <Field label="Name" htmlFor="saved-name" error={err?.field('name') ?? (err && !err.errors?.length ? err.title : undefined)} required>
          <Input id="saved-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Checkbox label="Share with everyone who can run this report" checked={shared} onChange={(e) => setShared(e.target.checked)} />
        <p className="text-xs text-text-muted">Shared reports only show data each viewer is allowed to see.</p>
      </form>
    </Dialog>
  );
}
