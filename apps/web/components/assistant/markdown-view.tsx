import { Fragment } from 'react';
import { parseMarkdown, type Inline } from './markdown';

/** Renders the safe Markdown subset as React elements; text is always escaped, never HTML. */
function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.t === 'bold' ? (
          <strong key={i} className="font-semibold">
            {p.v}
          </strong>
        ) : p.t === 'code' ? (
          <code key={i} className="rounded-sm bg-surface-muted px-1 py-0.5 font-mono text-[0.85em]">
            {p.v}
          </code>
        ) : (
          <Fragment key={i}>{p.v}</Fragment>
        ),
      )}
    </>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="space-y-2 break-words">
      {blocks.map((b, i) => {
        if (b.t === 'h')
          return (
            <p key={i} className="font-semibold">
              <Inlines parts={b.inl} />
            </p>
          );
        if (b.t === 'ul' || b.t === 'ol') {
          const List = b.t;
          return (
            <List key={i} className={`space-y-0.5 pl-5 ${b.t === 'ul' ? 'list-disc' : 'list-decimal'}`}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inlines parts={it} />
                </li>
              ))}
            </List>
          );
        }
        if (b.t === 'table')
          return (
            <div key={i} className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {b.head.map((c, j) => (
                      <th key={j} className="border-b border-border px-2 py-1 text-left font-semibold">
                        <Inlines parts={c} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => (
                        <td key={k} className="border-b border-border px-2 py-1">
                          <Inlines parts={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        return (
          <p key={i}>
            <Inlines parts={b.inl} />
          </p>
        );
      })}
    </div>
  );
}
