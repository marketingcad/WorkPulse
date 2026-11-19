'use client';
import { useMemo, useState } from 'react';
import { Lock, Pencil } from 'lucide-react';
import type { MemberDetailsDto, WorkerDto } from '@tallywork/contracts';
import { Button, ErrorState, Field, Input, Panel, SkeletonRows, Stat, Textarea, fmtDate, useToast } from '@tallywork/ui';
import { ApiError, errorMessage, useOrgQuery } from '@/lib/api';
import { addDays, todayIn } from '@/lib/org';
import { useOrgAction } from '@/components/workspace/basics';
import { formErrors } from '@/lib/form-checks';
import { personalInfoProblems } from '@/lib/personal-info';
import { usePhone } from '@/lib/phone-lazy';
import { PhoneInput, defaultPhoneCountry } from '@/components/phone-input';

/**
 * A member's personal info (the Personal info tab of their profile): identity, contact, emergency
 * contact and background, with the server's checks before saving. Its own module, loaded when the tab
 * is opened, so the member page stays within the first-load budget (bundle budget, 20 Nov 2026).
 */

type DetailKey = keyof MemberDetailsDto;
const DETAIL_SECTIONS: Array<{ title: string; fields: Array<{ key: DetailKey; label: string; type?: string; wide?: boolean; long?: boolean; max: number }> }> = [
  {
    title: 'Identity',
    fields: [
      { key: 'first_name', label: 'First name', max: 100 },
      { key: 'last_name', label: 'Last name', max: 100 },
      { key: 'birth_date', label: 'Birth date', type: 'date', max: 10 },
    ],
  },
  {
    title: 'Contact',
    fields: [
      { key: 'personal_email', label: 'Personal email', type: 'email', max: 254 },
      { key: 'phone', label: 'Phone number', type: 'tel', max: 50 },
      { key: 'address', label: 'Address', wide: true, max: 500 },
      { key: 'city', label: 'City', max: 100 },
      { key: 'region', label: 'State / region', max: 100 },
      { key: 'postal_code', label: 'Postal code', max: 20 },
      { key: 'country', label: 'Country', max: 100 },
    ],
  },
  {
    title: 'Emergency contact',
    fields: [
      { key: 'emergency_contact_name', label: 'Name', max: 150 },
      { key: 'emergency_contact_phone', label: 'Phone number', type: 'tel', max: 50 },
    ],
  },
  {
    title: 'Background',
    fields: [
      { key: 'education', label: 'Education', wide: true, long: true, max: 1000 },
      { key: 'notes', label: 'HR notes', wide: true, long: true, max: 5000 },
    ],
  },
];

export function PersonalTab({ w }: { w: WorkerDto }) {
  const q = useOrgQuery<MemberDetailsDto>(`/workers/${w.id}/details`);
  const run = useOrgAction();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const phoneCountry = useMemo(() => defaultPhoneCountry(), []);
  // Formats stored numbers; loaded after the page, so they show as stored (E.164) for a moment.
  const phone = usePhone();

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!d)
    return (
      <Panel>
        <SkeletonRows rows={5} cols={2} />
      </Panel>
    );

  // `notes` is only returned to admins, so the member never sees an HR notes field.
  const sections = DETAIL_SECTIONS.map((s) => ({ ...s, fields: s.fields.filter((x) => x.key in d) })).filter((s) => s.fields.length);
  const start = () => {
    setF(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v ?? ''])));
    setErr(null);
    setEditing(true);
  };
  const save = async () => {
    if (busy) return;
    const body = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== (d[k as DetailKey] ?? '')).map(([k, v]) => [k, v.trim() || null]));
    // The server's rules, checked before sending so each problem shows beside its field (form validation audit, 20 Nov 2026).
    const problems = personalInfoProblems(body, todayIn(w.timezone));
    if (problems.length) return setErr(formErrors(problems));
    setBusy(true);
    setErr(null);
    try {
      await run('PATCH', `/workers/${w.id}/details`, body);
      toast.success('Personal info saved');
      setEditing(false);
    } catch (e) {
      if (e instanceof ApiError) setErr(e);
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Personal info"
      actions={
        !editing && (
          <Button size="xs" icon={<Pencil className="size-3" />} onClick={start}>
            Edit
          </Button>
        )
      }
    >
      <p className="flex items-start gap-2 px-4 pt-4 text-xs text-text-muted">
        <Lock className="mt-0.5 size-3 shrink-0" />
        Only this member and workspace admins can see these details. They are deleted if the member’s data is erased.
      </p>
      <form
        className="flex flex-col gap-5 p-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {sections.map((s) => (
          <section key={s.title} className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{s.title}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {s.fields.map((x) =>
                editing ? (
                  <Field key={x.key} label={x.label} htmlFor={`pd-${x.key}`} error={err?.field(x.key)} className={x.wide ? 'sm:col-span-3' : undefined}>
                    {x.type === 'tel' ? (
                      <PhoneInput id={`pd-${x.key}`} value={f[x.key] ?? ''} defaultCountry={phoneCountry} onChange={(v) => setF((cur) => ({ ...cur, [x.key]: v }))} />
                    ) : x.long ? (
                      <Textarea id={`pd-${x.key}`} value={f[x.key] ?? ''} maxLength={x.max} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} className="min-h-16" />
                    ) : (
                      <Input
                        id={`pd-${x.key}`}
                        type={x.type ?? 'text'}
                        value={f[x.key] ?? ''}
                        maxLength={x.type === 'date' ? undefined : x.max}
                        {...(x.key === 'birth_date' ? { min: '1900-01-01', max: addDays(todayIn(w.timezone), -1) } : {})}
                        onChange={(e) => setF({ ...f, [x.key]: e.target.value })}
                      />
                    )}
                  </Field>
                ) : (
                  <div key={x.key} className={x.wide ? 'sm:col-span-3' : undefined}>
                    <Stat label={x.label} value={<span className={x.long ? 'whitespace-pre-wrap' : undefined}>{x.type === 'date' && d[x.key] ? fmtDate(d[x.key]!) : x.type === 'tel' && d[x.key] ? (phone?.displayPhone(d[x.key]) ?? d[x.key]) : (d[x.key] ?? '—')}</span>} />
                  </div>
                ),
              )}
            </div>
          </section>
        ))}
        {editing && (
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy}>
              Save personal info
            </Button>
          </div>
        )}
      </form>
    </Panel>
  );
}
