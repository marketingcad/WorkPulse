'use client';
import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import type { AssistantDraftDto } from '@tallywork/contracts/assistant';
import { Button, Dialog, Field, Textarea } from '@tallywork/ui';
import { api } from '@/lib/api';
import { useOrg } from '@/lib/org';

/**
 * A reminder email for people who have not submitted a timesheet, drafted by WorkPulse AI from the
 * names the person may see. Edit it and copy it into your own email: WorkPulse never sends it.
 */
export default function ReminderDraftDialog({ period, onClose }: { period: { from: string; to: string }; onClose: () => void }) {
  const org = useOrg();
  const [text, setText] = useState('');
  const [facts, setFacts] = useState<string[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    api<AssistantDraftDto>(`/orgs/${org.organization.id}/assistant/drafts`, { body: { kind: 'timesheet_reminder', from: period.from, to: period.to } })
      .then((r) => {
        if (!live) return;
        setText(r.text);
        setFacts(r.facts_used);
        setState('ready');
      })
      .catch(() => live && setState('error'));
    return () => {
      live = false;
    };
  }, [org.organization.id, period.from, period.to]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Reminder draft"
      description="Written by WorkPulse AI. Edit it, then copy it into your email. WorkPulse does not send it."
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon={<Copy className="size-3.5" aria-hidden />} disabled={state !== 'ready' || !text.trim()} onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </>
      }
    >
      {state === 'loading' && <p className="text-sm text-text-muted">Writing a draft…</p>}
      {state === 'error' && (
        <p role="alert" className="text-sm text-danger">
          WorkPulse AI could not write a draft right now. Try again in a moment.
        </p>
      )}
      {state === 'ready' && (
        <div className="flex flex-col gap-2">
          <Field label="Message" htmlFor="reminder-text">
            <Textarea id="reminder-text" rows={10} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
          </Field>
          {facts.length > 0 && <p className="text-2xs text-text-muted">Based on: {facts.join(' · ')}</p>}
        </div>
      )}
    </Dialog>
  );
}
