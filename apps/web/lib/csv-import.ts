import type { TimeTypeDto } from '@tallywork/contracts';
import type { Assignment } from '@/components/project-task-picker';

export const MAX_ROWS = 200;
export const HEADER = ['Date', 'Start', 'End', 'Project', 'Task', 'Note', 'Type'];

export interface ImportRow {
  line: number;
  date: string;
  start: string;
  end: string;
  project: string;
  task: string;
  note: string;
  type: string;
  projectId: string | null;
  taskId: string | null;
  timeTypeId: string | null;
  error: string | null;
  result?: { ok: boolean; message: string };
}

const norm = (s: string) => s.trim().toLowerCase();
/** A real calendar day: Date.parse alone accepts 2026-02-30 and rolls it into March. */
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const hhmm = (s: string) => {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${m[1]!.padStart(2, '0')}:${m[2]}` : null;
};

/** Maps CSV rows to projects/tasks the member can log to and checks each one before import. */
export function toRows(cells: string[][], assignments: Assignment[], types: TimeTypeDto[]): ImportRow[] {
  const head = (cells[0] ?? []).map(norm);
  const hasHeader = head.includes('date') && head.includes('project');
  const col = (name: string, fallback: number) => (hasHeader ? head.indexOf(name) : fallback);
  const idx = { date: col('date', 0), start: col('start', 1), end: col('end', 2), project: col('project', 3), task: col('task', 4), note: col('note', 5), type: col('type', 6) };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  return cells.slice(hasHeader ? 1 : 0).map((r, i) => {
    const row: ImportRow = { line: i + (hasHeader ? 2 : 1), date: get(r, idx.date), start: get(r, idx.start), end: get(r, idx.end), project: get(r, idx.project), task: get(r, idx.task), note: get(r, idx.note), type: get(r, idx.type), projectId: null, taskId: null, timeTypeId: null, error: null };
    const p = assignments.find((a) => norm(a.project_name) === norm(row.project));
    const t = p && row.task ? p.tasks.find((x) => norm(x.title) === norm(row.task)) : undefined;
    const tt = row.type ? types.find((x) => norm(x.name) === norm(row.type) || norm(x.short_name) === norm(row.type)) : undefined;
    row.timeTypeId = tt?.id ?? null;
    const s = hhmm(row.start);
    const e = hhmm(row.end);
    if (!isDay(row.date)) row.error = 'Date must be YYYY-MM-DD';
    else if (!s || !e) row.error = 'Start and end must be HH:MM (24h)';
    else if (e <= s) row.error = 'End must be after start';
    else if (!p) row.error = row.project ? `No project “${row.project}” you can log to` : 'Project is missing';
    else if (row.task && !t) row.error = `No open task “${row.task}” in ${p.project_name}`;
    else if (row.type && !tt) row.error = `No time type “${row.type}”`;
    row.projectId = p?.project_id ?? null;
    row.taskId = t?.id ?? null;
    if (s) row.start = s;
    if (e) row.end = e;
    return row;
  });
}
