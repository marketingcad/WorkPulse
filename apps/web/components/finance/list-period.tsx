'use client';
import { useState } from 'react';
import { useOrg } from '@/lib/org';
import { DateRangeFilter, type ListPreset } from '@/components/reports/date-range';

/**
 * The period filter of a finance list page: "Any date" by default (the list as before), or a
 * period that filters the list and is what Export downloads.
 */
export function useListPeriod() {
  const org = useOrg();
  const [period, setPeriod] = useState<{ preset: ListPreset; from: string; to: string }>({ preset: 'all', from: '', to: '' });
  const picker = <DateRangeFilter<ListPreset> preset={period.preset} from={period.from} to={period.to} onChange={setPeriod} tz={org.organization.timezone} weekStart={org.organization.week_start} allowAll />;
  return { from: period.from, to: period.to, filter: period.from && period.to ? { from: period.from, to: period.to } : {}, picker };
}
