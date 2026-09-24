'use client';
import type { WorkerDto } from '@tallywork/contracts';
import { Input, Select } from '@tallywork/ui';
import { useOrgQuery } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { daySpan, presetRange, type DateRange, type RangePreset } from './time';

const PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'last_week', label: 'Last week' },
  { value: 'custom', label: 'Custom range' },
];

export const MAX_RANGE_DAYS = 400;

/** Viewer timezone for "today" style presets. */
export function useViewerTz(): string {
  const org = useOrg();
  return org.membership.timezone || org.organization.timezone;
}

export function useDefaultRange(preset: Exclude<RangePreset, 'custom'>): DateRange {
  const org = useOrg();
  return presetRange(preset, org.membership.timezone || org.organization.timezone, org.organization.week_start);
}

/** Preset select + from/to inputs. Keeps ranges valid (from ≤ to, ≤ 400 days). */
export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const org = useOrg();
  const tz = useViewerTz();
  const setCustom = (from: string, to: string) => {
    if (!from || !to) return;
    if (from > to) [from, to] = [to, from];
    if (daySpan(from, to) > MAX_RANGE_DAYS) return;
    onChange({ preset: 'custom', from, to });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Date range"
        className="w-36"
        value={value.preset}
        onChange={(e) => {
          const p = e.target.value as RangePreset;
          if (p === 'custom') onChange({ ...value, preset: 'custom' });
          else onChange(presetRange(p, tz, org.organization.week_start));
        }}
      >
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </Select>
      <Input type="date" aria-label="From date" className="w-36" value={value.from} max={value.to} onChange={(e) => setCustom(e.target.value, value.to)} />
      <span className="text-xs text-text-faint" aria-hidden>
        –
      </span>
      <Input type="date" aria-label="To date" className="w-36" value={value.to} min={value.from} onChange={(e) => setCustom(value.from, e.target.value)} />
    </div>
  );
}

/** Active, tracking-enabled members the viewer may see (managers only; null for workers). */
export function useTrackedWorkers() {
  const org = useOrg();
  const q = useOrgQuery<WorkerDto[]>(org.isManagerView && org.can('members:read') ? '/workers' : null, { staleTime: 60_000 });
  const rows = q.data?.filter((w) => w.tracking_enabled && w.status === 'ACTIVE').sort((a, b) => a.name.localeCompare(b.name));
  return { ...q, rows };
}

/** Single-member filter with an "All members" option. Renders nothing for workers. */
export function MemberFilter({ value, onChange, allLabel = 'All members' }: { value: string; onChange: (id: string) => void; allLabel?: string }) {
  const org = useOrg();
  const { rows } = useTrackedWorkers();
  if (!org.isManagerView) return null;
  return (
    <Select aria-label="Member" className="w-48" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allLabel}</option>
      {rows?.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </Select>
  );
}
