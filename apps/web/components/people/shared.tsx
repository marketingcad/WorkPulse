'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, IconButton, Input } from '@tallywork/ui';

// ─── API shapes (packages/api/src/services/operations.ts) ────────────────────
export type AttendanceStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'ON_LEAVE' | 'HOLIDAY' | 'UNSCHEDULED';

export interface AttendanceRow {
  membership_id: string;
  worker_name: string;
  date: string;
  status: AttendanceStatus;
  scheduled_start: string | null;
  scheduled_end: string | null;
  first_in: string | null;
  last_out: string | null;
  worked_seconds: number;
  scheduled_seconds: number;
  late_seconds: number;
  early_leave_seconds: number;
  overtime_seconds: number;
}

export interface ScheduleDay {
  dow: number;
  start: string;
  end: string;
}

export interface ScheduleRow {
  id: string;
  membership_id: string;
  worker_name: string;
  name: string;
  timezone: string;
  days: ScheduleDay[];
  effective_from: string;
  effective_to: string | null;
}

export interface ShiftInstance {
  membership_id: string;
  date: string;
  starts_at: string;
  ends_at: string;
  kind: 'SCHEDULED' | 'ONE_OFF';
}

export interface HolidayRow {
  id: string;
  date: string;
  name: string;
  paid: boolean;
}

export type AccrualType = 'none' | 'annual' | 'monthly' | 'per_hour_worked';

export interface TimeOffPolicy {
  id: string;
  name: string;
  paid: boolean;
  accrual: { type: AccrualType; amountHours: number; maxBalanceHours: number | null; carryOverHours: number | null };
  requires_approval: boolean;
  hours_per_day: number;
  applies_to_all: boolean;
  member_ids: string[];
}

export interface TimeOffBalance {
  policy_id: string;
  policy_name: string;
  paid: boolean;
  balance_hours: number | null;
  pending_hours: number;
  used_hours: number;
}

export type TimeOffStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface TimeOffRequest {
  id: string;
  membership_id: string;
  worker_name: string;
  policy_id: string;
  policy_name: string;
  start_date: string;
  end_date: string;
  half_day: boolean;
  hours: number;
  reason: string | null;
  status: TimeOffStatus;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  created_at: string;
}

// ─── Display helpers ─────────────────────────────────────────────────────────
export const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Weekday indexes (0 = Sunday) starting from the org's week start. */
export function orderedDows(weekStart: number): number[] {
  return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

/** 24h wall-clock time ("09:00") of an instant in a time zone. */
export function wallTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  }
}

export function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—';
  return `${Math.round(h * 100) / 100}h`;
}

export function dateRangeLabel(start: string, end: string): string {
  const s = new Date(`${start}T12:00:00Z`);
  const e = new Date(`${end}T12:00:00Z`);
  const f = (d: Date, withYear: boolean) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(d);
  if (start === end) return f(s, true);
  return `${f(s, s.getUTCFullYear() !== e.getUTCFullYear())} – ${f(e, true)}`;
}

export const COMMON_TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/Denver',
  'America/Phoenix',
  'America/Chicago',
  'America/New_York',
  'America/Toronto',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Warsaw',
  'Europe/Kyiv',
  'Europe/Istanbul',
  'Africa/Lagos',
  'Africa/Cairo',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Manila',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
];

export function timezoneOptions(...extra: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const z of extra) if (z) set.add(z);
  for (const z of COMMON_TIMEZONES) set.add(z);
  return [...set];
}

/** Previous / next / today stepper with a date input. */
export function DateStepper({ value, onChange, step, today, label = 'Date', todayLabel = 'Today', type = 'date' }: { value: string; onChange: (v: string) => void; step: (dir: -1 | 1) => void; today: string; label?: string; todayLabel?: string; type?: 'date' | 'month' }) {
  return (
    <div className="flex items-center gap-1">
      <IconButton label="Previous" variant="secondary" onClick={() => step(-1)}>
        <ChevronLeft className="size-4" />
      </IconButton>
      <Input
        type={type}
        aria-label={label}
        className="w-40"
        value={type === 'month' ? value.slice(0, 7) : value}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          onChange(type === 'month' ? `${v}-01` : v);
        }}
      />
      <IconButton label="Next" variant="secondary" onClick={() => step(1)}>
        <ChevronRight className="size-4" />
      </IconButton>
      <Button onClick={() => onChange(today)} disabled={value === today}>
        {todayLabel}
      </Button>
    </div>
  );
}
