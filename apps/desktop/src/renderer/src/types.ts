// Shapes returned by the desktop own-data API (/api/v1/agent/me/*).
export type { ActivityDayDto, ClientVisibilityDto, NotificationDto, PayStubDto, SessionDto, TaskDto, TimesheetDto } from '@tallywork/contracts';

export interface SummaryDto {
  from: string;
  to: string;
  worked_seconds: number;
  tracked_seconds: number;
  manual_seconds: number;
  billable_seconds: number;
  active_seconds: number;
  idle_seconds: number;
  activity_pct: number | null;
  days: Array<{ date: string; seconds: number }>;
  projects: Array<{ project_id: string; project_name: string; color: string; seconds: number }>;
}

export interface TimeOffDto {
  balances: Array<{ policy_id: string; policy_name: string; paid: boolean; balance_hours: number | null; pending_hours: number; used_hours: number }>;
  requests: Array<{
    id: string;
    policy_id: string;
    policy_name: string;
    start_date: string;
    end_date: string;
    half_day: boolean;
    hours: number;
    reason: string | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    decided_by_name: string | null;
    decision_comment: string | null;
    created_at: string;
  }>;
}

export interface ShiftDto {
  membership_id: string;
  date: string;
  starts_at: string;
  ends_at: string;
  kind: 'SCHEDULED' | 'ONE_OFF';
}

export interface NotificationsDto {
  data: import('@tallywork/contracts').NotificationDto[];
  unread: number;
}
