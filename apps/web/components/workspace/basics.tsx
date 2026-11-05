'use client';
import { useQueryClient } from '@tanstack/react-query';
import type { ProjectDto } from '@tallywork/contracts';
import { Badge, StatusBadge, cx, type Tone } from '@tallywork/ui';
import { api, useOrgId } from '@/lib/api';

/**
 * The small, widely used pieces of the workspace (constants, badges, hour conversions, useOrgAction).
 * Kept apart from shared.tsx, whose task and project dialogs most pages that need these never open.
 */
// ─── Constants ───────────────────────────────────────────────────────────────
/** Project colours are data (stored on the project), so hex values are allowed here. */
export const PROJECT_COLORS = ['#2563eb', '#0891b2', '#0d9488', '#059669', '#65a30d', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#9333ea', '#4f46e5', '#475569'];

export const TASK_STATUSES = [
  { value: 'TODO', label: 'To do' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'DONE', label: 'Done' },
] as const;

export const PRIORITIES = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
] as const;

export const PROJECT_STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' },
] as const;

export interface RoleDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  builtin: boolean;
}

export const hoursToSeconds = (h: string): number | null => {
  const n = Number(h);
  return h.trim() === '' || !Number.isFinite(n) ? null : Math.round(n * 3600);
};
export const secondsToHours = (s: number | null | undefined): string => (s === null || s === undefined ? '' : String(Math.round((s / 3600) * 100) / 100));

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Call an org endpoint and refresh every org query afterwards. */
export function useOrgAction() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return async function run<T = unknown>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const r = await api<T>(`/orgs/${orgId}${path}`, { method, body });
    await qc.invalidateQueries({ queryKey: ['org', orgId] });
    return r;
  };
}

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cx('inline-block size-2.5 shrink-0 rounded-full', className)} style={{ background: color }} />;
}

const PRIORITY_TONE: Record<string, Tone> = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', URGENT: 'danger' };
export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRIORITY_TONE[priority] ?? 'neutral'}>{PRIORITIES.find((p) => p.value === priority)?.label ?? priority}</Badge>;
}

export function ProjectStatusBadge({ project }: { project: Pick<ProjectDto, 'status' | 'archived_at'> }) {
  if (project.archived_at) return <StatusBadge status="ARCHIVED" />;
  return <StatusBadge status={project.status} label={PROJECT_STATUSES.find((s) => s.value === project.status)?.label} />;
}

export function ColorPicker({ value, onChange, label = 'Project colour' }: { value: string; onChange: (c: string) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {PROJECT_COLORS.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c}
          aria-label={`Colour ${i + 1}`}
          title={c}
          onClick={() => onChange(c)}
          className={cx('size-6 rounded-full border-2 transition-transform hover:scale-110', value.toLowerCase() === c ? 'border-text ring-2 ring-interactive/30' : 'border-transparent')}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}
