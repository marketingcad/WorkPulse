'use client';
import { useEffect, useMemo, useState } from 'react';
import { Info, RotateCcw } from 'lucide-react';
import type { TeamDto } from '@tallywork/contracts';
import type { TrackingPolicy } from '@tallywork/domain';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Input, PageHeader, Panel, PermissionState, SegmentedControl, Select, SkeletonRows, Switch, Textarea, cx, fmtDateTime, useToast } from '@tallywork/ui';
import { ApiError, useOrgMutation, useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { POLICY_SECTIONS, displayPolicyValue, type PolicyField } from '@/components/settings/policy-fields';
import { useMemberOptions } from '@/lib/members';
import { HelpLink } from '@/components/help/help-link';

type ScopeType = 'ORG' | 'TEAM' | 'WORKER';
type Doc = Record<string, Record<string, unknown>>;
interface Layer {
  scope_type: ScopeType;
  scope_id: string;
  doc: Doc;
  version: number;
  inherited: TrackingPolicy;
  updated_at: string | null;
}

const getIn = (d: Doc, s: string, k: string): unknown => d[s]?.[k];
function setIn(d: Doc, s: string, k: string, v: unknown): Doc {
  const next: Doc = { ...d, [s]: { ...(d[s] ?? {}) } };
  if (v === undefined) {
    delete next[s]![k];
    if (Object.keys(next[s]!).length === 0) delete next[s];
  } else next[s]![k] = v;
  return next;
}
const countOverrides = (d: Doc) => Object.values(d).reduce((n, s) => n + Object.keys(s ?? {}).length, 0);

export default function PoliciesPage() {
  const org = useOrg();
  const toast = useToast();
  const canRead = org.can('policies:read');
  const canEdit = org.can('policies:manage');
  const [scopeType, setScopeType] = useState<ScopeType>('ORG');
  // A scope change waiting for "discard unsaved changes?" to be confirmed.
  const [pendingScope, setPendingScope] = useState<ScopeType | null>(null);
  const [teamId, setTeamId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const teamsQ = useOrgQuery<TeamDto[]>(canRead && scopeType === 'TEAM' ? '/teams' : null);
  const workersQ = useMemberOptions(canRead && scopeType === 'WORKER' && org.can('members:read'));
  const scopeId = scopeType === 'ORG' ? org.organization.id : scopeType === 'TEAM' ? teamId : workerId;
  const layerQ = useOrgQuery<Layer>(canRead && scopeId ? `/policies/${scopeType}/${scopeId}` : null);
  const [doc, setDoc] = useState<Doc>({});
  useEffect(() => {
    if (layerQ.data) setDoc((layerQ.data.doc ?? {}) as Doc);
  }, [layerQ.data]);
  const dirty = !!layerQ.data && JSON.stringify(doc) !== JSON.stringify(layerQ.data.doc ?? {});

  const save = useOrgMutation<Doc, Layer>('PUT', `/policies/${scopeType}/${scopeId}`, { onSuccess: () => toast.success('Policy saved. Affected members have been notified.') });
  const err = save.error instanceof ApiError ? save.error : null;

  const scopeName = scopeType === 'ORG' ? 'Organization default' : scopeType === 'TEAM' ? (teamsQ.data?.find((t) => t.id === teamId)?.name ?? 'Team') : (workersQ.data?.find((w) => w.id === workerId)?.name ?? 'Member');
  const inheritedFrom = scopeType === 'ORG' ? 'WorkPulse default' : 'Organization default';

  if (!canRead) return <PermissionState />;

  return (
    <>
      <PageHeader
        title="Tracking policies"
        description="Decide what is monitored. Settings flow from the organization default to teams, then to individual members; the most specific override wins."
        actions={
          <>
            <HelpLink article="tracking-policies" />
            {canEdit && layerQ.data && (
              <>
                <Button disabled={!dirty || save.isPending} onClick={() => setDoc((layerQ.data?.doc ?? {}) as Doc)}>
                  Discard
                </Button>
                <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(doc)}>
                  Save policy
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 flex items-start gap-2.5 rounded-md border border-info/30 bg-info-soft px-4 py-3 text-sm text-info" role="note">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p>
          <span className="font-medium">Transparency:</span> when you save, everyone affected by this policy is notified that their tracking settings changed. Make sure your members know what is monitored where the law requires it.
        </p>
      </div>

      <ConfirmDialog
        open={pendingScope !== null}
        onOpenChange={(o) => !o && setPendingScope(null)}
        title="Discard unsaved policy changes?"
        description="Your changes to this policy have not been saved. Switching to another scope discards them."
        confirmLabel="Discard changes"
        danger
        onConfirm={() => {
          if (pendingScope) setScopeType(pendingScope);
          setPendingScope(null);
        }}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Policy scope"
          value={scopeType}
          onChange={(v) => (dirty ? setPendingScope(v) : setScopeType(v))}
          options={[
            { value: 'ORG', label: 'Organization default' },
            { value: 'TEAM', label: 'Team' },
            { value: 'WORKER', label: 'Member' },
          ]}
        />
        {scopeType === 'TEAM' && (
          <Select aria-label="Team" className="w-56" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Choose a team…</option>
            {teamsQ.data
              ?.filter((t) => !t.archived_at)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </Select>
        )}
        {scopeType === 'WORKER' && (
          <Select aria-label="Member" className="w-56" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
            <option value="">Choose a member…</option>
            {workersQ.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        )}
        {layerQ.data && (
          <span className="text-xs text-text-muted">
            {countOverrides(doc)} {countOverrides(doc) === 1 ? 'override' : 'overrides'}
            {layerQ.data.updated_at && ` · last changed ${fmtDateTime(layerQ.data.updated_at)}`}
            {dirty && <Badge tone="warning" className="ml-2">Unsaved</Badge>}
          </span>
        )}
      </div>

      {err && (
        <p role="alert" className="mb-4 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger">
          {err.title}
          {err.errors?.length ? `: ${err.errors.map((e) => `${e.field} ${e.message}`).join('; ')}` : ''}
        </p>
      )}

      {!scopeId ? (
        <Panel>
          <EmptyState title={scopeType === 'TEAM' ? 'Pick a team' : 'Pick a member'} description={`Overrides here apply on top of the organization default${scopeType === 'WORKER' ? ' and team policies' : ''}.`} />
        </Panel>
      ) : layerQ.error ? (
        <Panel>
          <ErrorState error={layerQ.error} onRetry={() => layerQ.refetch()} />
        </Panel>
      ) : !layerQ.data ? (
        <Panel>
          <SkeletonRows rows={10} cols={3} />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {POLICY_SECTIONS.map((sec) => (
            <Panel
              key={sec.key}
              title={
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">{sec.title}</h2>
                  {(sec.description || sec.disabled) && <p className="text-xs text-text-muted">{sec.disabled ?? sec.description}</p>}
                </div>
              }
              className={cx(sec.disabled && 'border-dashed')}
            >
              <ul className="divide-y divide-border">
                {sec.fields.map((field) => (
                  <PolicyRow
                    key={field.key}
                    field={field}
                    inherited={(layerQ.data!.inherited as unknown as Doc)[field.section]?.[field.key]}
                    override={getIn(doc, field.section, field.key)}
                    inheritedFrom={inheritedFrom}
                    readOnly={!canEdit || !!field.disabled}
                    onChange={(v) => setDoc((d) => setIn(d, field.section, field.key, v))}
                  />
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
      {layerQ.data && scopeType !== 'ORG' && <p className="mt-3 text-xs text-text-faint">Editing: {scopeName}. Fields without an override follow the {inheritedFrom.toLowerCase()}.</p>}
    </>
  );
}

function PolicyRow({ field, inherited, override, inheritedFrom, readOnly, onChange }: { field: PolicyField; inherited: unknown; override: unknown; inheritedFrom: string; readOnly: boolean; onChange: (v: unknown) => void }) {
  const overridden = override !== undefined;
  const value = overridden ? override : inherited;
  const id = `pol-${field.section}-${field.key}`;
  return (
    <li className={cx('flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between', overridden && 'bg-interactive-soft/30')}>
      <div className="min-w-0 sm:max-w-[55%]">
        <label htmlFor={id} className="block text-sm font-medium">
          {field.label}
        </label>
        {field.help && <p className="text-xs text-text-muted">{field.help}</p>}
        <p className="mt-1 text-xs">
          {field.disabled ? (
            <span className="text-text-faint">{field.disabled}</span>
          ) : overridden ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <Badge tone="brand">Overridden</Badge>
              <span className="text-text-faint">
                {inheritedFrom}: {displayPolicyValue(field, inherited)}
              </span>
              {!readOnly && (
                <button type="button" onClick={() => onChange(undefined)} className="inline-flex items-center gap-1 font-medium text-interactive hover:underline">
                  <RotateCcw className="size-3" aria-hidden /> Reset to inherited
                </button>
              )}
            </span>
          ) : (
            <span className="text-text-faint">
              Inherited: {displayPolicyValue(field, inherited)} <span className="text-text-faint">({inheritedFrom.toLowerCase()})</span>
            </span>
          )}
        </p>
      </div>
      <div className="shrink-0 sm:w-56 sm:text-right">
        <Control id={id} field={field} value={value} readOnly={readOnly} onChange={onChange} />
      </div>
    </li>
  );
}

function Control({ id, field, value, readOnly, onChange }: { id: string; field: PolicyField; value: unknown; readOnly: boolean; onChange: (v: unknown) => void }) {
  const k = field.kind;
  switch (k.type) {
    case 'bool':
      return (
        <span className="inline-flex">
          <Switch id={id} checked={!!value} onCheckedChange={(v) => onChange(v)} disabled={readOnly} />
        </span>
      );
    case 'select':
      return (
        <Select id={id} value={String(value ?? '')} disabled={readOnly} onChange={(e) => onChange(e.target.value)}>
          {k.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case 'numselect':
      return (
        <Select id={id} value={String(value ?? '')} disabled={readOnly} onChange={(e) => onChange(Number(e.target.value))}>
          {k.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case 'number':
      return <NumberControl id={id} value={Number(value ?? 0)} min={k.min} max={k.max} unit={k.unit} readOnly={readOnly} onChange={onChange} />;
    case 'hours':
      return <HoursControl id={id} value={value as number | null} max={k.max} readOnly={readOnly} onChange={onChange} />;
    case 'domains':
      return <DomainsControl id={id} value={Array.isArray(value) ? (value as string[]) : []} readOnly={readOnly} onChange={onChange} />;
  }
}

function NumberControl({ id, value, min, max, unit, readOnly, onChange }: { id: string; value: number; min: number; max: number; unit: string; readOnly: boolean; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const n = Number(text);
  const bad = text === '' || !Number.isInteger(n) || n < min || n > max;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="inline-flex items-center gap-1.5">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          step={1}
          className="tabular w-24 text-right"
          value={text}
          disabled={readOnly}
          aria-invalid={bad}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value !== '' && Number.isInteger(v) && v >= min && v <= max) onChange(v);
          }}
        />
        <span className="w-7 text-left text-xs text-text-muted">{unit}</span>
      </span>
      {bad && !readOnly && (
        <span className="text-2xs text-danger">
          {min}–{max}
        </span>
      )}
    </span>
  );
}

function HoursControl({ id, value, max, readOnly, onChange }: { id: string; value: number | null; max: number; readOnly: boolean; onChange: (v: unknown) => void }) {
  const toText = (v: number | null) => (v === null || v === undefined ? '' : String(Math.round((v / 3600) * 100) / 100));
  const [text, setText] = useState(toText(value));
  useEffect(() => setText(toText(value)), [value]);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Input
        id={id}
        type="number"
        min={0}
        max={max}
        step={0.5}
        placeholder="No limit"
        className="tabular w-24 text-right"
        value={text}
        disabled={readOnly}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value === '') return onChange(null);
          const h = Number(e.target.value);
          if (Number.isFinite(h) && h >= 0 && h <= max) onChange(Math.round(h * 3600));
        }}
      />
      <span className="w-7 text-left text-xs text-text-muted">h</span>
    </span>
  );
}

function DomainsControl({ id, value, readOnly, onChange }: { id: string; value: string[]; readOnly: boolean; onChange: (v: unknown) => void }) {
  const joined = useMemo(() => value.join('\n'), [value]);
  const [text, setText] = useState(joined);
  useEffect(() => setText(joined), [joined]);
  return (
    <Textarea
      id={id}
      rows={3}
      className="font-mono text-xs"
      placeholder={'bank.example\nhealth.example'}
      value={text}
      disabled={readOnly}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const list = [...new Set(text.split(/[\s,]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean))].slice(0, 500);
        if (list.join('\n') !== joined) onChange(list);
        else setText(joined);
      }}
    />
  );
}
