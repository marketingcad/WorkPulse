'use client';
import { useState } from 'react';
import { Sparkles, Undo2 } from 'lucide-react';
import type { AssistantDraftDto, AssistantDraftInput } from '@tallywork/contracts/assistant';
import { Button, Menu, MenuItem, MenuSeparator } from '@tallywork/ui';
import { api, ApiError } from '@/lib/api';
import { useOrg } from '@/lib/org';

type Style = 'improve' | 'shorter' | 'longer' | 'professional' | 'friendly';
const STYLES: Array<{ style: Style; label: string }> = [
  { style: 'improve', label: 'Improve writing' },
  { style: 'shorter', label: 'Make shorter' },
  { style: 'longer', label: 'Make longer' },
  { style: 'professional', label: 'More professional' },
  { style: 'friendly', label: 'More friendly' },
];

/**
 * "Write with AI" for a text field: draft from the record's own facts (when it exists) or rewrite
 * what is typed. The result goes into the field to edit; nothing is saved until the person saves,
 * and Undo puts the previous text back. Loaded on demand; shown only when WorkPulse AI is on.
 */
/**
 * `onChange` must set only the field (an updater on the latest form state): a draft can arrive
 * after the person changed other fields. `onBusy` lets the field be read-only while it is written.
 */
export default function DraftButton({ value, onChange, onBusy, source }: { value: string; onChange: (text: string) => void; onBusy?: (busy: boolean) => void; source?: { kind: 'project_description'; project_id: string } | { kind: 'task_description'; task_id: string } }) {
  const org = useOrg();
  const [busy, setBusyState] = useState(false);
  const setBusy = (b: boolean) => {
    setBusyState(b);
    onBusy?.(b);
  };
  const [previous, setPrevious] = useState<string | null>(null);
  const [facts, setFacts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const run = async (input: AssistantDraftInput) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<AssistantDraftDto>(`/orgs/${org.organization.id}/assistant/drafts`, { body: input });
      setPrevious(value);
      setFacts(r.facts_used);
      onChange(r.text);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? 'WorkPulse AI is busy. Try again in a moment; your text is unchanged.' : 'WorkPulse AI could not write this right now. Your text is unchanged.');
    } finally {
      setBusy(false);
    }
  };
  const hasText = value.trim().length > 0;
  return (
    <div className="mt-1 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Menu
          trigger={
            <Button size="xs" variant="ghost" icon={<Sparkles className="size-3" aria-hidden />} loading={busy} disabled={!source && !hasText}>
              Write with AI
            </Button>
          }
        >
          {source && <MenuItem onSelect={() => run(source)}>Draft from what WorkPulse knows</MenuItem>}
          {source && hasText && <MenuSeparator />}
          {hasText && STYLES.map((s) => <MenuItem key={s.style} onSelect={() => run({ kind: 'rewrite', text: value, style: s.style })}>{s.label}</MenuItem>)}
        </Menu>
        {previous !== null && (
          <Button
            size="xs"
            variant="ghost"
            icon={<Undo2 className="size-3" aria-hidden />}
            onClick={() => {
              onChange(previous);
              setPrevious(null);
              setFacts([]);
            }}
          >
            Undo
          </Button>
        )}
        {!source && !hasText && <span className="text-2xs text-text-faint">Type something first, or save the record to draft from its details.</span>}
      </div>
      {previous !== null && <p className="text-2xs text-text-muted">Written by WorkPulse AI. Check it before saving{facts.length ? `. Based on: ${facts.join(' · ')}` : ''}.</p>}
      {error && (
        <p role="alert" className="text-2xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
