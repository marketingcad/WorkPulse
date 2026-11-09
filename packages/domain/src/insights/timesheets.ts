import { findingId, percentChange } from './compare';
import type { Finding, Period } from './types';

/**
 * Timesheet review rules. Exact conditions (overlaps, duplicates) are facts; the rest are
 * observations worded neutrally: something "may need a look", never that someone did wrong.
 */

export interface EntrySpan {
  id: string;
  membershipId: string;
  memberName: string;
  projectId: string | null;
  /** ISO instants; `end` is null while the timer runs. */
  start: string;
  end: string | null;
  source: 'TRACKED' | 'MANUAL';
}

export interface SheetSummary {
  timesheetId: string;
  membershipId: string;
  memberName: string;
  periodStart: string;
  status: string;
  totalSeconds: number;
  manualSeconds: number;
  previousTotalSeconds: number | null;
  /** As returned by the approval queue (high_manual, under_expected, late_time …). */
  flags: string[];
}

const ms = (iso: string) => Date.parse(iso);
const hours = (s: number) => Math.round(s / 36) / 100;
const MAX_NAMES = 20;
const listNames = (names: string[]) => {
  const unique = [...new Set(names)];
  const shown = unique.slice(0, MAX_NAMES).join(', ');
  return unique.length > MAX_NAMES ? `${shown} and ${unique.length - MAX_NAMES} more` : shown;
};

/** Overlapping finished entries of the same member; each pair once. Touching ends do not overlap. */
export function findOverlaps(entries: EntrySpan[]): Array<{ a: EntrySpan; b: EntrySpan; overlapSeconds: number }> {
  const out: Array<{ a: EntrySpan; b: EntrySpan; overlapSeconds: number }> = [];
  const byMember = new Map<string, EntrySpan[]>();
  for (const e of entries) if (e.end !== null && ms(e.end) > ms(e.start)) byMember.set(e.membershipId, [...(byMember.get(e.membershipId) ?? []), e]);
  for (const list of byMember.values()) {
    list.sort((x, y) => ms(x.start) - ms(y.start));
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        if (ms(b.start) >= ms(a.end!)) break; // sorted by start: nothing later can overlap a
        const overlap = Math.min(ms(a.end!), ms(b.end!)) - ms(b.start);
        if (overlap > 0) out.push({ a, b, overlapSeconds: Math.round(overlap / 1000) });
      }
    }
  }
  return out;
}

/** Groups of two or more entries with the same member, project, start and end. */
export function findDuplicates(entries: EntrySpan[]): EntrySpan[][] {
  const groups = new Map<string, EntrySpan[]>();
  for (const e of entries) {
    if (e.end === null) continue;
    const k = `${e.membershipId}|${e.projectId ?? ''}|${ms(e.start)}|${ms(e.end)}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Approval-queue flags worth repeating. Never activity: monitoring data does not leave Approvals (and never reaches the AI). */
const FLAG_TEXT: Record<string, string> = {
  high_manual: 'a high share of manual time',
  under_expected: 'fewer hours than expected',
  over_expected: 'more hours than expected',
  late_time: 'time added late',
  needs_review: 'entries marked for review',
};

export function timesheetFindings(input: {
  period: Period;
  entries: EntrySpan[];
  sheets: SheetSummary[];
  missing: Array<{ membershipId: string; memberName: string }>;
  longDaySeconds?: number;
  /** Calendar day of an instant for the long-day rule (the organization's time zone); UTC by default. */
  dayOf?: (iso: string) => string;
}): Finding[] {
  const { period } = input;
  const longDay = input.longDaySeconds ?? 14 * 3600;
  const dayOf = input.dayOf ?? ((iso: string) => iso.slice(0, 10));
  const out: Finding[] = [];
  const base = { section: 'timesheets' as const, period, links: ['timesheets.approvals' as const] };

  for (const { a, b, overlapSeconds } of findOverlaps(input.entries)) {
    out.push({
      ...base,
      id: findingId('timesheets', 'overlap', `${a.id}:${b.id}`),
      category: 'overlap',
      severity: 'warning',
      basis: 'fact',
      title: `Overlapping time for ${a.memberName}`,
      summary: `Two of ${a.memberName}'s entries overlap by ${hours(overlapSeconds)} h, so that time may be counted twice.`,
      metrics: [{ label: 'Overlap', value: hours(overlapSeconds), unit: 'hours' }],
      refs: [{ type: 'member', id: a.membershipId, name: a.memberName }],
      next_step: 'Open the entries and correct the times before approving.',
    });
  }

  for (const group of findDuplicates(input.entries)) {
    const e = group[0]!;
    out.push({
      ...base,
      id: findingId('timesheets', 'duplicate', group.map((g) => g.id).join(':')),
      category: 'duplicate',
      severity: 'warning',
      basis: 'fact',
      title: `Repeated entry for ${e.memberName}`,
      summary: `${group.length} entries for ${e.memberName} have exactly the same project, start and end.`,
      metrics: [{ label: 'Identical entries', value: group.length, unit: 'count' }],
      refs: [{ type: 'member', id: e.membershipId, name: e.memberName }],
      next_step: 'Check whether all of them are needed before approving.',
    });
  }

  const perDay = new Map<string, { member: EntrySpan; seconds: number; day: string }>();
  for (const e of input.entries) {
    if (e.end === null) continue;
    const day = dayOf(e.start);
    const k = `${e.membershipId}|${day}`;
    const cur = perDay.get(k) ?? { member: e, seconds: 0, day };
    cur.seconds += Math.max(0, Math.round((ms(e.end) - ms(e.start)) / 1000));
    perDay.set(k, cur);
  }
  for (const { member, seconds, day } of perDay.values()) {
    if (seconds <= longDay) continue;
    out.push({
      ...base,
      id: findingId('timesheets', 'long_day', `${member.membershipId}:${day}`),
      category: 'long_day',
      severity: 'attention',
      basis: 'observation',
      title: `Long day for ${member.memberName}`,
      summary: `${member.memberName} recorded ${hours(seconds)} h on ${day}, more than ${hours(longDay)} h. It may be correct, or a timer may have been left running.`,
      metrics: [{ label: 'Hours that day', value: hours(seconds), unit: 'hours' }],
      refs: [{ type: 'member', id: member.membershipId, name: member.memberName }],
      next_step: 'Confirm the day with the member before approving.',
    });
  }

  for (const s of input.sheets) {
    const ref = [{ type: 'timesheet' as const, id: s.timesheetId, name: `${s.memberName}, week of ${s.periodStart}` }];
    if (s.totalSeconds >= 3600 && s.manualSeconds / s.totalSeconds > 0.25) {
      const share = Math.round((s.manualSeconds / s.totalSeconds) * 100);
      out.push({
        ...base,
        id: findingId('timesheets', 'manual_heavy', s.timesheetId),
        category: 'manual_heavy',
        severity: 'attention',
        basis: 'observation',
        title: `Mostly manual time for ${s.memberName}`,
        summary: `${share} % of ${s.memberName}'s ${hours(s.totalSeconds)} h was added by hand rather than tracked. That is often fine (meetings, travel) but may need a look.`,
        metrics: [{ label: 'Manual share', value: share, unit: 'percent' }],
        refs: ref,
        next_step: 'Read the reasons on the manual entries before approving.',
      });
    }
    const change = percentChange(s.totalSeconds, s.previousTotalSeconds, 4 * 3600);
    if (change !== null && Math.abs(change) >= 50) {
      out.push({
        ...base,
        id: findingId('timesheets', 'hours_change', s.timesheetId),
        category: 'hours_change',
        severity: 'info',
        basis: 'observation',
        title: `${change > 0 ? 'More' : 'Fewer'} hours than last period for ${s.memberName}`,
        summary: `${s.memberName} has ${hours(s.totalSeconds)} h this period against ${hours(s.previousTotalSeconds!)} h the period before (${change > 0 ? '+' : ''}${change} %).`,
        metrics: [{ label: 'Change', value: change, unit: 'percent' }, { label: 'Hours', value: hours(s.totalSeconds), unit: 'hours', previous: hours(s.previousTotalSeconds!) }],
        refs: ref,
        next_step: 'Check whether the change is expected (time off, a deadline) before approving.',
      });
    }
    const flagged = s.flags.filter((f) => FLAG_TEXT[f] && !(f === 'high_manual' && out.some((o) => o.id === findingId('timesheets', 'manual_heavy', s.timesheetId))));
    if (flagged.length) {
      out.push({
        ...base,
        id: findingId('timesheets', 'flagged', s.timesheetId),
        category: 'flagged',
        severity: 'info',
        basis: 'fact',
        title: `${s.memberName}'s timesheet is flagged`,
        summary: `The approval queue notes ${flagged.map((f) => FLAG_TEXT[f]).join(', ')}.`,
        metrics: [{ label: 'Flags', value: flagged.length, unit: 'count' }],
        refs: ref,
        next_step: 'Open the timesheet in Approvals to see the details.',
      });
    }
  }

  if (input.missing.length) {
    out.push({
      ...base,
      id: findingId('timesheets', 'missing', period.from),
      category: 'missing',
      severity: 'attention',
      basis: 'fact',
      title: `${input.missing.length} ${input.missing.length === 1 ? 'timesheet has' : 'timesheets have'} not been submitted`,
      summary: `Not submitted yet: ${listNames(input.missing.map((m) => m.memberName))}.`,
      metrics: [{ label: 'Not submitted', value: input.missing.length, unit: 'count' }],
      refs: input.missing.slice(0, MAX_NAMES).map((m) => ({ type: 'member' as const, id: m.membershipId, name: m.memberName })),
      next_step: 'Send a reminder, or check whether they were away.',
    });
  }
  return out;
}
