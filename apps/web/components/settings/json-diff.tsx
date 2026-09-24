'use client';
import { cx } from '@tallywork/ui';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const pretty = (v: unknown) => (v === undefined ? '' : JSON.stringify(v, null, 2));
const short = (v: unknown) => {
  if (v === undefined) return '—';
  const s = JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
};

/** Flatten nested objects into dotted paths so changes can be listed field by field. */
function flatten(v: unknown, prefix = '', out: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  if (isObj(v) && depth < 4) {
    const keys = Object.keys(v);
    if (!keys.length && prefix) out[prefix] = v;
    for (const k of keys) flatten(v[k], prefix ? `${prefix}.${k}` : k, out, depth + 1);
  } else if (prefix) out[prefix] = v;
  return out;
}

/** Before/after view for audit entries: a list of changed fields plus both documents pretty-printed. */
export function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const hasBefore = before !== null && before !== undefined;
  const hasAfter = after !== null && after !== undefined;
  if (!hasBefore && !hasAfter) return <p className="text-sm text-text-muted">No before/after data was recorded for this entry.</p>;
  const fb = hasBefore && isObj(before) ? flatten(before) : null;
  const fa = hasAfter && isObj(after) ? flatten(after) : null;
  const changes =
    fb || fa
      ? [...new Set([...Object.keys(fb ?? {}), ...Object.keys(fa ?? {})])]
          .filter((k) => !/(^|\.)updatedAt$|(^|\.)updated_at$/.test(k))
          .filter((k) => JSON.stringify(fb?.[k]) !== JSON.stringify(fa?.[k]))
          .filter((k) => !(fb && fa && fa[k] === undefined)) // a partial "after" patch does not mean fields were removed
          .sort()
      : [];
  return (
    <div className="flex flex-col gap-4">
      {changes.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Changed fields</h3>
          <div className="overflow-x-auto rounded-sm border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-muted/60 text-left text-2xs uppercase tracking-wide text-text-muted">
                  <th className="px-2 py-1.5 font-semibold">Field</th>
                  <th className="px-2 py-1.5 font-semibold">Before</th>
                  <th className="px-2 py-1.5 font-semibold">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border font-mono">
                {changes.map((k) => (
                  <tr key={k}>
                    <td className="px-2 py-1 align-top">{k}</td>
                    <td className="break-all px-2 py-1 align-top text-danger">{short(fb?.[k])}</td>
                    <td className="break-all px-2 py-1 align-top text-success">{short(fa?.[k])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className={cx('grid grid-cols-1 gap-3', hasBefore && hasAfter && 'md:grid-cols-2')}>
        {hasBefore && (
          <section className="min-w-0">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">Before</h3>
            <pre className="max-h-96 overflow-auto rounded-sm border border-border bg-danger-soft/40 p-2.5 font-mono text-2xs leading-relaxed">{pretty(before)}</pre>
          </section>
        )}
        {hasAfter && (
          <section className="min-w-0">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">After</h3>
            <pre className="max-h-96 overflow-auto rounded-sm border border-border bg-success-soft/40 p-2.5 font-mono text-2xs leading-relaxed">{pretty(after)}</pre>
          </section>
        )}
      </div>
    </div>
  );
}
