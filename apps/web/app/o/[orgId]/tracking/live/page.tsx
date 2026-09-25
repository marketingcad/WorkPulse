'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, MoreHorizontal, RefreshCw, Square, Timer } from 'lucide-react';
import type { LiveWorkerDto, SessionDto } from '@tallywork/contracts';
import {
  ActivityBar,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  KpiStrip,
  Menu,
  MenuItem,
  MenuSeparator,
  PageHeader,
  Panel,
  PermissionState,
  PersonCell,
  SegmentedControl,
  WorkerStatus,
  fmtRelative,
  fmtTime,
  useToast,
  type Column,
} from '@tallywork/ui';
import { errorMessage, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrgStream } from '@/lib/stream';
import { todayIn, useOrg } from '@/lib/org';
import { SessionDrawer } from '@/components/tracking/session-drawer';

type StatusFilter = 'ALL' | LiveWorkerDto['status'];

export default function LivePage() {
  const org = useOrg();
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stopping, setStopping] = useState<LiveWorkerDto | null>(null);
  const allowed = org.can('tracking:read');
  useOrgStream(['/tracking/live']);
  // The stream refreshes on every change; the slow poll only keeps elapsed times and idle states fresh.
  const q = useOrgQuery<LiveWorkerDto[]>(allowed ? '/tracking/live' : null, { refetchInterval: 60_000, refetchIntervalInBackground: false });
  const forceStop = useOrgMutation<{ id: string }, SessionDto>('POST', (b) => `/sessions/${b.id}/force-stop`);
  const canForceStop = org.can('tracking:force_stop');

  const counts = useMemo(() => {
    const rows = q.data ?? [];
    return { WORKING: rows.filter((r) => r.status === 'WORKING').length, IDLE: rows.filter((r) => r.status === 'IDLE').length, OFFLINE: rows.filter((r) => r.status === 'OFFLINE').length, total: rows.length };
  }, [q.data]);
  const rows = useMemo(() => (filter === 'ALL' ? q.data : q.data?.filter((r) => r.status === filter)), [q.data, filter]);
  const tz = org.membership.timezone || org.organization.timezone;
  const viewActivity = (w: LiveWorkerDto) => router.push(`${org.base}/activity?member=${w.membership_id}&date=${todayIn(tz)}`);

  const confirmStop = async () => {
    if (!stopping?.session_id) return;
    try {
      await forceStop.mutateAsync({ id: stopping.session_id });
      toast.success(`Stopped ${stopping.name}'s timer`);
      setStopping(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (!allowed) return <PermissionState />;

  const columns: Column<LiveWorkerDto>[] = [
    { key: 'name', header: 'Member', cell: (w) => <PersonCell name={w.name} />, value: (w) => w.name, priority: 'primary' },
    { key: 'status', header: 'Status', cell: (w) => <WorkerStatus status={w.status} />, value: (w) => ({ WORKING: 0, IDLE: 1, OFFLINE: 2 })[w.status], priority: 'secondary' },
    {
      key: 'project',
      header: 'Project / task',
      cell: (w) =>
        w.project_name ? (
          <span className="block max-w-72 truncate">
            {w.project_name}
            {w.task_title && <span className="text-text-muted"> / {w.task_title}</span>}
          </span>
        ) : (
          <span className="text-text-faint">Not tracking</span>
        ),
      value: (w) => `${w.project_name ?? ''} ${w.task_title ?? ''}`,
      priority: 'secondary',
    },
    { key: 'started', header: 'Started', cell: (w) => <span className="tabular text-text-muted">{fmtTime(w.started_at)}</span>, value: (w) => w.started_at ?? '' },
    { key: 'activity', header: 'Activity', cell: (w) => <ActivityBar pct={w.activity_pct} />, value: (w) => w.activity_pct ?? -1, priority: 'secondary' },
    { key: 'today', header: 'Today', cell: (w) => org.fmtDuration(w.today_seconds), value: (w) => w.today_seconds, align: 'right', priority: 'secondary' },
    { key: 'seen', header: 'Last seen', cell: (w) => <span className="text-xs text-text-muted">{w.status === 'WORKING' ? 'now' : fmtRelative(w.last_seen_at)}</span>, value: (w) => w.last_seen_at ?? '' },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: '48px',
      sortable: false,
      cell: (w) => (
        <div onClick={(e) => e.stopPropagation()} className="flex justify-end">
          <Menu
            trigger={
              <IconButton label={`Actions for ${w.name}`} size="xs">
                <MoreHorizontal className="size-4" />
              </IconButton>
            }
          >
            <MenuItem icon={<Activity className="size-3.5" />} onSelect={() => viewActivity(w)}>
              View activity
            </MenuItem>
            <MenuItem icon={<Timer className="size-3.5" />} disabled={!w.session_id} onSelect={() => w.session_id && setSessionId(w.session_id)}>
              View session
            </MenuItem>
            {canForceStop && w.session_id && (
              <>
                <MenuSeparator />
                <MenuItem danger icon={<Square className="size-3.5" />} onSelect={() => setStopping(w)}>
                  Force stop timer
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Who is working now"
        description="Live status of members with tracking enabled. Refreshes every 15 seconds."
        actions={
          <Button icon={<RefreshCw className={q.isFetching ? 'size-3.5 animate-spin' : 'size-3.5'} />} onClick={() => void q.refetch()}>
            Refresh
          </Button>
        }
      />
      <KpiStrip
        className="mb-4"
        items={[
          { label: 'Working', value: <span className="text-success">{counts.WORKING}</span> },
          { label: 'Idle / paused', value: <span className="text-warning">{counts.IDLE}</span> },
          { label: 'Offline', value: counts.OFFLINE },
          { label: 'Members tracked', value: counts.total },
        ]}
      />
      <Panel
        title="Members"
        actions={
          <SegmentedControl
            size="xs"
            label="Filter by status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'ALL', label: `All ${counts.total}` },
              { value: 'WORKING', label: `Working ${counts.WORKING}` },
              { value: 'IDLE', label: `Idle ${counts.IDLE}` },
              { value: 'OFFLINE', label: `Offline ${counts.OFFLINE}` },
            ]}
          />
        }
      >
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(w) => w.membership_id}
            loading={q.isLoading}
            searchable
            searchPlaceholder="Search members or projects…"
            onRowClick={viewActivity}
            caption="Live member status"
            empty={
              filter === 'ALL' ? (
                <EmptyState title="No members with tracking enabled" description="Enable tracking for members in Workers, then they will appear here while they work." />
              ) : (
                <EmptyState title={`Nobody is ${filter === 'WORKING' ? 'working' : filter === 'IDLE' ? 'idle' : 'offline'} right now`} />
              )
            }
          />
        )}
      </Panel>

      <SessionDrawer sessionId={sessionId} onClose={() => setSessionId(null)} />
      <ConfirmDialog
        open={!!stopping}
        onOpenChange={(o) => !o && setStopping(null)}
        title="Force stop this timer?"
        danger
        confirmLabel="Stop timer"
        loading={forceStop.isPending}
        onConfirm={confirmStop}
        description={
          <>
            <strong className="text-text">{stopping?.name}</strong>’s running session
            {stopping?.project_name ? ` on ${stopping.project_name}` : ''} will end now. Time already tracked is kept, and the action is recorded in the audit log.
          </>
        }
      />
    </>
  );
}
