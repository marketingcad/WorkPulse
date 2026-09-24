'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Square } from 'lucide-react';
import type { CurrentTrackingDto } from '@tallywork/contracts';
import { Button, StatusBadge, Tooltip, cx, fmtClock } from '@tallywork/ui';
import { api, errorMessage, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { useToast } from '@tallywork/ui';
import { ProjectTaskPicker, type PickerValue } from '../project-task-picker';

/** Live elapsed seconds for a session snapshot (server authoritative, ticks locally). */
export function useLiveSeconds(cur: CurrentTrackingDto | undefined, fetchedAt: number) {
  const [now, setNow] = useState(Date.now());
  const running = !!cur?.session?.current_segment_started_at;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const drift = running ? Math.max(0, Math.floor((now - fetchedAt) / 1000)) : 0;
  return {
    session: (cur?.session?.worked_seconds ?? 0) + drift,
    today: (cur?.today_seconds ?? 0) + drift,
    week: (cur?.week_seconds ?? 0) + drift,
    running,
  };
}

export function useCurrentTracking() {
  const q = useOrgQuery<CurrentTrackingDto>('/tracking/current', { refetchInterval: 15_000 });
  return { ...q, fetchedAt: q.dataUpdatedAt };
}

/** Persistent timer in the top bar: visible on every page (web tracking). */
export function TimerBar() {
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: cur, fetchedAt } = useCurrentTracking();
  const live = useLiveSeconds(cur, fetchedAt);
  const [sel, setSel] = useState<PickerValue>({ projectId: null, taskId: null });
  const [busy, setBusy] = useState(false);
  const s = cur?.session ?? null;

  useEffect(() => {
    if (s) setSel({ projectId: s.project_id, taskId: s.task_id });
  }, [s?.project_id, s?.task_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const call = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      const r = await api<CurrentTrackingDto>(`/orgs/${org.organization.id}/tracking/${path}`, { method: 'POST', body: body ?? {} });
      qc.setQueryData(['org', org.organization.id, '/tracking/current'], r);
      void qc.invalidateQueries({ queryKey: ['org', org.organization.id] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onPick = (v: PickerValue) => {
    setSel(v);
    if (s && s.source !== 'DESKTOP' && v.projectId && (v.projectId !== s.project_id || v.taskId !== s.task_id)) void call('switch', { project_id: v.projectId, task_id: v.taskId });
  };

  const desktop = s?.source === 'DESKTOP';
  const state = s?.state;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="hidden min-w-0 max-w-sm flex-1 sm:block">
        <ProjectTaskPicker value={sel} onChange={onPick} compact disabled={busy || desktop} placeholder="What are you working on?" />
      </div>
      <div className={cx('tabular flex h-8 items-center gap-2 rounded-sm px-2 font-mono text-sm', live.running ? 'bg-success-soft text-success' : 'text-text-muted')} aria-live="off">
        <span className={cx('size-1.5 rounded-full', live.running ? 'animate-pulse bg-success' : 'bg-text-faint')} aria-hidden />
        {fmtClock(s ? live.session : 0)}
      </div>
      {s ? (
        <>
          {state === 'ACTIVE' && !desktop && (
            <Tooltip content="Pause (break)">
              <Button size="sm" variant="ghost" className="w-8 px-0" aria-label="Pause" onClick={() => call('pause')} disabled={busy}>
                <Pause className="size-3.5" />
              </Button>
            </Tooltip>
          )}
          {state === 'PAUSED' && !desktop && (
            <Button size="sm" variant="subtle" icon={<Play className="size-3.5" />} onClick={() => call('resume')} disabled={busy}>
              Resume
            </Button>
          )}
          {desktop ? (
            <StatusBadge status="DESKTOP" label="Tracking on desktop" />
          ) : (
            <Button size="sm" variant="danger" icon={<Square className="size-3 fill-current" />} onClick={() => call('stop')} loading={busy}>
              <span className="hidden sm:inline">Stop</span>
            </Button>
          )}
        </>
      ) : (
        <Button size="sm" variant="primary" icon={<Play className="size-3.5 fill-current" />} onClick={() => (sel.projectId ? call('start', { project_id: sel.projectId, task_id: sel.taskId }) : toast.info('Choose a project first'))} loading={busy}>
          <span className="hidden sm:inline">Start</span>
        </Button>
      )}
      <span className="tabular hidden whitespace-nowrap text-xs text-text-muted lg:inline">
        Today <span className="font-semibold text-text">{org.fmtDuration(live.today)}</span>
      </span>
    </div>
  );
}
