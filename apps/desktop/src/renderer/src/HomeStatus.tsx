import { useState } from 'react';
import { CircleAlert, CloudOff, Hourglass, ShieldAlert, Trash2, ClockPlus } from 'lucide-react';
import type { AgentState } from '../../shared/ipc';
import type { NotAddedItem } from '../../shared/not-added';
import { permissionNeeds } from '../../shared/permissions';
import { bridge, card, fmtTime } from './lib';

/** What the manual-time form starts with when asking for time the server did not add. */
export interface ManualPrefill {
  notAddedId: string;
  projectId: string | null;
  taskId: string | null;
  from: string;
  to: string;
}

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function Banner({ tone, icon: Icon, title, children, label }: { tone: 'warning' | 'info' | 'danger'; icon: typeof CloudOff; title: string; children?: React.ReactNode; label: string }) {
  const cls = tone === 'danger' ? 'border-danger/40 bg-danger-soft' : tone === 'warning' ? 'border-warning/40 bg-warning-soft' : 'border-interactive/30 bg-interactive-soft';
  const ic = tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : 'text-interactive';
  return (
    <section aria-label={label} className={`flex gap-3 rounded-md border p-3 text-sm ${cls}`}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${ic}`} aria-hidden />
      <div className="min-w-0">
        <h2 className="font-semibold text-text">{title}</h2>
        <div className="mt-0.5 text-text-muted">{children}</div>
      </div>
    </section>
  );
}

/**
 * The states a worker must never have to guess: this computer waiting for approval, offline (and
 * with which saved settings, until when), offline for too long, and macOS permissions missing.
 */
export function StatusBanners({ s }: { s: AgentState }) {
  const pending = s.device?.status.toUpperCase() === 'PENDING';
  const o = s.offline;
  const needs = permissionNeeds(s.policy, s.permissions);
  return (
    <>
      {pending && (
        <Banner tone="info" icon={Hourglass} label="Waiting for approval" title="Waiting for your administrator to approve this computer">
          You can clock in now. Your time is saved on this computer and sent as soon as an administrator approves it under Settings › Devices. Nothing is lost while you wait.
          {s.sync.queued > 0 && <span className="mt-1 block text-xs">{s.sync.queued} records saved on this computer, waiting to be sent.</span>}
        </Banner>
      )}
      {o.pausedAt && o.mode !== 'expired' && (
        <Banner tone="warning" icon={CloudOff} label="Tracking paused" title={`Tracking was paused at ${when(o.pausedAt)}: you were offline for too long`}>
          No time has been recorded since then. Your time up to {fmtTime(o.pausedAt)} is kept{o.mode === 'online' ? ' and is being sent' : ''}. {o.mode === 'online' ? 'Clock back in when you want to continue.' : 'Connect to the internet, then clock back in.'}
        </Banner>
      )}
      {o.mode === 'expired' ? (
        <Banner tone="danger" icon={CloudOff} label="Offline" title={o.pausedAt ? `Tracking paused at ${when(o.pausedAt)}: offline for too long` : 'Offline for too long: connect to clock in'}>
          Your organization allows {s.policy?.tracking.maxOfflineHours ?? 24} hours offline, and that ended {o.allowedUntil ? when(o.allowedUntil) : 'a while ago'}.{o.pausedAt ? ' No time is being recorded.' : ''} Time already saved on this computer is kept and sent when you reconnect. Then clock back in to continue: tracking does not restart on its own.
        </Banner>
      ) : (
        o.mode === 'offline' && (
          <Banner tone="warning" icon={CloudOff} label="Offline" title="You are offline: your time is saved on this computer">
            It is sent automatically when you are back online.
            {o.settingsSavedAt && <span className="mt-1 block">Using your projects and tracking settings saved on {when(o.settingsSavedAt)}.</span>}
            {o.allowedUntil && <span className="mt-1 block">You can keep tracking offline until {when(o.allowedUntil)}.</span>}
            {o.totalsPartial && <span className="mt-1 block text-xs">Today and week totals may be missing some time until you reconnect.</span>}
          </Banner>
        )
      )}
      {needs.map((n) => (
        <Banner key={n.kind} tone="warning" icon={ShieldAlert} label={`${n.setting} permission`} title={`Allow ${n.setting} for Tallywork`}>
          Your organization records {n.needed}, and macOS has not allowed it yet, so nothing is recorded. In System Settings › Privacy &amp; Security › {n.setting}, turn on <strong>Tallywork</strong> (the name WorkPulse has on your Mac), then quit and reopen WorkPulse.
          <button onClick={() => void bridge.openPermissionSettings(n.kind)} className="mt-2 block rounded-sm border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text hover:bg-surface-muted">
            Open {n.setting} settings
          </button>
        </Banner>
      ))}
    </>
  );
}

/**
 * Time (or monitoring data) the server did not accept, never dropped silently: what, when, why,
 * and what the worker can do about it. Kept on this computer until they have dealt with it.
 */
export function NotAddedCard({ s, onRequest }: { s: AgentState; onRequest: (p: ManualPrefill) => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!s.notAdded.length) return null;
  const canRequest = !!s.policy?.manualTime.allowed;
  const name = (i: NotAddedItem) => s.assignments.find((a) => a.project_id === i.projectId)?.project_name ?? (i.projectId ? 'A project you are no longer on' : 'Unknown project');
  return (
    <section className={`${card} overflow-hidden border-danger/40`} aria-labelledby="not-added-title">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <CircleAlert className="size-4 text-danger" aria-hidden />
        <h2 id="not-added-title" className="text-sm font-semibold">
          Not added to your time
        </h2>
      </div>
      <p className="px-4 pt-2 text-xs text-text-muted">These were recorded on this computer but not accepted, usually because something changed while you were offline. They are kept here until you deal with them.</p>
      <ul className="divide-y divide-border">
        {s.notAdded.map((i) => (
          <li key={i.id} className="px-4 py-3 text-sm">
            <div className="font-medium">
              {i.kind === 'time' ? name(i) : 'Monitoring data'} · {when(i.from)} – {fmtTime(i.to)}
            </div>
            <p className="text-xs text-text-muted">{i.reason}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {i.kind === 'time' &&
                (canRequest ? (
                  <button onClick={() => onRequest({ notAddedId: i.id, projectId: i.projectId, taskId: i.taskId, from: i.from, to: i.to })} className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-interactive px-3 text-xs font-semibold text-on-accent hover:bg-interactive-hover">
                    <ClockPlus className="size-3.5" aria-hidden /> Ask for this time
                  </button>
                ) : (
                  <span className="text-xs text-text-muted">Your organization does not allow manual time: ask your manager to add it.</span>
                ))}
              {confirm === i.id ? (
                <span className="inline-flex flex-wrap items-center gap-2 text-xs">
                  {i.kind === 'time' ? 'Remove it from this computer? The time will not be added.' : 'Remove this note?'}
                  <button onClick={() => void bridge.dismissNotAdded(i.id)} className="h-8 rounded-sm border border-danger px-3 font-semibold text-danger hover:bg-danger-soft">
                    Remove
                  </button>
                  <button onClick={() => setConfirm(null)} className="h-8 rounded-sm border border-border px-3 hover:bg-surface-muted">
                    Keep
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirm(i.id)} className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border px-3 text-xs hover:bg-surface-muted">
                  <Trash2 className="size-3.5" aria-hidden /> {i.kind === 'time' ? 'Remove' : 'OK, remove'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
