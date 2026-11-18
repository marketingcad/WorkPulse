/**
 * Project revision history, read from the audit log (target_type 'project'). Pure helpers: which
 * actions count as a project revision, and what changed between the stored before and after values.
 * Time-entry edits are audited under their own targets and never appear here.
 */

/** Audit actions on a project that are revisions of it. */
export const PROJECT_REVISION_ACTIONS = ['project.created', 'project.updated', 'project.archived', 'project.restored'] as const;
export type ProjectRevisionAction = (typeof PROJECT_REVISION_ACTIONS)[number];

/** Fields a project revision reports, in display order. Anything else in the audit row is ignored. */
export const PROJECT_REVISION_FIELDS = [
  'name',
  'client_id',
  'status',
  'description',
  'short_name',
  'color',
  'billable_default',
  'start_date',
  'end_date',
  'estimate_seconds',
  'estimate_unit',
  'member_ids',
  'team_ids',
  'breaks',
  'pay_rate_minor',
  'bill_rate_minor',
] as const;
export type ProjectRevisionField = (typeof PROJECT_REVISION_FIELDS)[number];

/** Money fields: shown only to people who may read rates. */
export const PROJECT_RATE_FIELDS: readonly ProjectRevisionField[] = ['pay_rate_minor', 'bill_rate_minor'];

export interface ProjectRevisionChange {
  field: ProjectRevisionField;
  /** the value before the change; null when it was empty or `before_known` is false */
  before: unknown;
  after: unknown;
  /** false for revisions recorded before previous values were kept: only the new value is known */
  before_known: boolean;
}

type Values = Record<string, unknown> | null | undefined;

const UNORDERED = new Set<ProjectRevisionField>(['member_ids', 'team_ids']);

function normalize(field: ProjectRevisionField, v: unknown): unknown {
  if (v === undefined || v === '') return null;
  if (UNORDERED.has(field) && Array.isArray(v)) return [...v].map(String).sort();
  return v;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The fields that changed in one revision. A field counts only when the after values contain it (a
 * PATCH that left it out did not change it). With before values, unchanged fields are dropped; without
 * them (older rows) every field sent is reported, with `before_known: false`.
 */
export function projectRevisionChanges(before: Values, after: Values, opts: { includeRates: boolean }): ProjectRevisionChange[] {
  if (!after || typeof after !== 'object') return [];
  const known = !!before && typeof before === 'object';
  const out: ProjectRevisionChange[] = [];
  for (const field of PROJECT_REVISION_FIELDS) {
    if (!opts.includeRates && PROJECT_RATE_FIELDS.includes(field)) continue;
    if (!(field in after)) continue;
    const next = normalize(field, after[field]);
    if (known) {
      const prev = normalize(field, (before as Record<string, unknown>)[field]);
      if (same(prev, next)) continue;
      out.push({ field, before: prev, after: next, before_known: true });
    } else {
      out.push({ field, before: null, after: next, before_known: false });
    }
  }
  return out;
}

/** Share of a project's tasks that are done, as a whole percent; null without tasks. */
export function projectProgressPct(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((Math.min(done, total) / total) * 100);
}
