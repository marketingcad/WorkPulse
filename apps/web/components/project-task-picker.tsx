'use client';
import { useMemo, useRef, useState } from 'react';
import * as P from '@radix-ui/react-popover';
import { ChevronDown, FolderKanban, Search } from 'lucide-react';
import { cx } from '@tallywork/ui';
import { useOrgQuery } from '@/lib/api';

export interface Assignment {
  project_id: string;
  project_name: string;
  color: string;
  client_name: string | null;
  tasks: Array<{ id: string; title: string; status: string }>;
}

export interface PickerValue {
  projectId: string | null;
  taskId: string | null;
}

/** Combined project/task search ("proj / task"), keyboard navigable. */
export function ProjectTaskPicker({ value, onChange, disabled, compact, placeholder = 'Select a project', assignments: given }: { value: PickerValue; onChange: (v: PickerValue) => void; disabled?: boolean; compact?: boolean; placeholder?: string; assignments?: Assignment[] }) {
  const { data } = useOrgQuery<Assignment[]>(given ? null : '/me/assignments', { staleTime: 60_000 });
  const assignments = given ?? data ?? [];
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out: Array<{ projectId: string; taskId: string | null; label: string; sub: string | null; color: string }> = [];
    for (const a of assignments) {
      const pMatch = !needle || a.project_name.toLowerCase().includes(needle) || (a.client_name ?? '').toLowerCase().includes(needle);
      if (pMatch) out.push({ projectId: a.project_id, taskId: null, label: a.project_name, sub: a.client_name, color: a.color });
      for (const t of a.tasks) {
        if (!needle || t.title.toLowerCase().includes(needle) || pMatch || `${a.project_name} / ${t.title}`.toLowerCase().includes(needle)) out.push({ projectId: a.project_id, taskId: t.id, label: t.title, sub: a.project_name, color: a.color });
      }
    }
    return out.slice(0, 200);
  }, [assignments, q]);

  const current = assignments.find((a) => a.project_id === value.projectId);
  const currentTask = current?.tasks.find((t) => t.id === value.taskId);

  const choose = (o: (typeof options)[number]) => {
    onChange({ projectId: o.projectId, taskId: o.taskId });
    setOpen(false);
    setQ('');
  };

  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className={cx('flex min-w-0 items-center gap-2 rounded-sm border border-border bg-surface text-left text-sm hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-60', compact ? 'h-8 px-2' : 'h-9 w-full px-2.5')}
          aria-label="Choose project and task"
        >
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: current?.color ?? 'var(--color-border-strong)' }} />
          <span className="min-w-0 flex-1 truncate">
            {current ? (
              <>
                <span className="font-medium">{current.project_name}</span>
                {currentTask && <span className="text-text-muted"> / {currentTask.title}</span>}
              </>
            ) : (
              <span className="text-text-faint">{placeholder}</span>
            )}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-text-faint" />
        </button>
      </P.Trigger>
      <P.Portal>
        <P.Content align="start" sideOffset={4} className="z-50 w-[min(420px,calc(100vw-24px))] rounded-md border border-border bg-surface shadow-overlay">
          <div className="relative border-b border-border p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-text-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCursor((c) => Math.min(options.length - 1, c + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCursor((c) => Math.max(0, c - 1));
                } else if (e.key === 'Enter' && options[cursor]) {
                  e.preventDefault();
                  choose(options[cursor]!);
                }
              }}
              placeholder="Search projects and tasks…"
              aria-label="Search projects and tasks"
              className="h-8 w-full rounded-sm bg-surface-muted pl-7 pr-2 text-sm focus:outline-none"
            />
          </div>
          <ul ref={listRef} role="listbox" className="max-h-80 overflow-y-auto p-1">
            {options.length === 0 && (
              <li className="flex flex-col items-center gap-1 px-3 py-6 text-center text-sm text-text-muted">
                <FolderKanban className="size-5 text-text-faint" />
                {assignments.length ? 'No matches' : 'You are not assigned to any active project yet.'}
              </li>
            )}
            {options.map((o, i) => (
              <li
                key={`${o.projectId}:${o.taskId ?? ''}`}
                role="option"
                aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(o)}
                className={cx('flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm', i === cursor && 'bg-surface-muted', o.taskId && 'pl-6')}
              >
                {!o.taskId && <span className="size-2.5 shrink-0 rounded-full" style={{ background: o.color }} />}
                <span className="min-w-0 flex-1 truncate">
                  <span className={o.taskId ? '' : 'font-medium'}>{o.label}</span>
                  {!o.taskId && o.sub && <span className="text-text-faint"> · {o.sub}</span>}
                </span>
              </li>
            ))}
          </ul>
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
