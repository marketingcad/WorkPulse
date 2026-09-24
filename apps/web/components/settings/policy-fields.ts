import type { TrackingPolicy } from '@tallywork/domain';

export type SectionKey = keyof TrackingPolicy;

export type FieldKind =
  | { type: 'bool' }
  | { type: 'select'; options: Array<{ value: string; label: string }> }
  | { type: 'numselect'; options: Array<{ value: number; label: string }> }
  | { type: 'number'; min: number; max: number; unit: string }
  | { type: 'hours'; max: number }
  | { type: 'domains' };

export interface PolicyField {
  section: SectionKey;
  key: string;
  label: string;
  help?: string;
  kind: FieldKind;
  /** shown but not editable */
  disabled?: string;
}

export interface PolicySection {
  key: SectionKey;
  title: string;
  description?: string;
  disabled?: string;
  fields: PolicyField[];
}

const b = { type: 'bool' } as const;

export const POLICY_SECTIONS: PolicySection[] = [
  {
    key: 'tracking',
    title: 'Tracking',
    description: 'Where and how people can run a timer.',
    fields: [
      { section: 'tracking', key: 'allowWeb', label: 'Allow the web timer', kind: b },
      { section: 'tracking', key: 'allowDesktop', label: 'Allow the desktop app', kind: b },
      { section: 'tracking', key: 'singleTimer', label: 'When a second timer is started', kind: { type: 'select', options: [{ value: 'supersede', label: 'Stop the running timer' }, { value: 'reject', label: 'Refuse the new timer' }] } },
      { section: 'tracking', key: 'maxPauseMinutes', label: 'Stop paused timers after', kind: { type: 'number', min: 1, max: 1440, unit: 'min' } },
      { section: 'tracking', key: 'recoveryWindowMinutes', label: 'Crash recovery window', help: 'Time after a crash in which a session can be resumed.', kind: { type: 'number', min: 1, max: 240, unit: 'min' } },
      { section: 'tracking', key: 'heartbeatGraceSeconds', label: 'Heartbeat grace', help: 'How long a silent desktop app keeps its session open.', kind: { type: 'number', min: 60, max: 3600, unit: 'sec' } },
      { section: 'tracking', key: 'maxOfflineHours', label: 'Maximum offline tracking', help: 'Time tracked offline beyond this is not accepted.', kind: { type: 'number', min: 1, max: 168, unit: 'h' } },
    ],
  },
  {
    key: 'activity',
    title: 'Activity',
    fields: [{ section: 'activity', key: 'enabled', label: 'Record activity levels', help: 'Counts keyboard and mouse events per minute. Which keys are pressed is never recorded.', kind: b }],
  },
  {
    key: 'idle',
    title: 'Idle',
    fields: [
      { section: 'idle', key: 'enabled', label: 'Detect idle time', kind: b },
      { section: 'idle', key: 'thresholdMinutes', label: 'Idle after', kind: { type: 'number', min: 1, max: 120, unit: 'min' } },
      { section: 'idle', key: 'behavior', label: 'When idle is detected', kind: { type: 'select', options: [{ value: 'prompt', label: 'Ask the member' }, { value: 'pause', label: 'Pause the timer' }, { value: 'keep', label: 'Keep tracking, mark as idle' }] } },
      { section: 'idle', key: 'confirmationTimeoutMinutes', label: 'Wait for an answer for', kind: { type: 'number', min: 1, max: 240, unit: 'min' } },
      { section: 'idle', key: 'defaultResolution', label: 'If nobody answers', kind: { type: 'select', options: [{ value: 'keep', label: 'Keep the idle time' }, { value: 'discard', label: 'Discard the idle time' }] } },
    ],
  },
  {
    key: 'screenshots',
    title: 'Screenshots',
    fields: [
      { section: 'screenshots', key: 'enabled', label: 'Capture screenshots', kind: b },
      { section: 'screenshots', key: 'perTenMinutes', label: 'Frequency', kind: { type: 'numselect', options: [{ value: 0, label: 'Off' }, { value: 1, label: '1 per 10 minutes' }, { value: 2, label: '2 per 10 minutes' }, { value: 3, label: '3 per 10 minutes' }] } },
      { section: 'screenshots', key: 'blur', label: 'Blur screenshots', kind: b },
      { section: 'screenshots', key: 'notify', label: 'Notify the member on capture', kind: b },
      { section: 'screenshots', key: 'workerCanDelete', label: 'Members can delete their screenshots', kind: b },
      { section: 'screenshots', key: 'deleteRemovesTime', label: 'Deleting a screenshot removes its time', kind: b },
    ],
  },
  {
    key: 'apps',
    title: 'Apps',
    fields: [{ section: 'apps', key: 'enabled', label: 'Record application names', help: 'Which application is in the foreground, not what is typed in it.', kind: b }],
  },
  {
    key: 'urls',
    title: 'URLs',
    fields: [
      { section: 'urls', key: 'enabled', label: 'Record websites', kind: b },
      { section: 'urls', key: 'mode', label: 'Detail', kind: { type: 'select', options: [{ value: 'domain', label: 'Domain only (example.com)' }, { value: 'full', label: 'Full address without query string' }] } },
      { section: 'urls', key: 'excludedDomains', label: 'Never record these domains', help: 'One per line. Subdomains are included.', kind: { type: 'domains' } },
    ],
  },
  {
    key: 'location',
    title: 'Location',
    disabled: 'Requires the mobile app — future.',
    fields: [{ section: 'location', key: 'enabled', label: 'Record location', kind: b, disabled: 'Requires the mobile app — future.' }],
  },
  {
    key: 'limits',
    title: 'Limits',
    description: 'Tracking stops when a limit is reached. Leave empty for no limit.',
    fields: [
      { section: 'limits', key: 'dailySeconds', label: 'Daily limit', kind: { type: 'hours', max: 24 } },
      { section: 'limits', key: 'weeklySeconds', label: 'Weekly limit', kind: { type: 'hours', max: 168 } },
    ],
  },
  {
    key: 'manualTime',
    title: 'Manual time',
    fields: [
      { section: 'manualTime', key: 'allowed', label: 'Allow manual time', kind: b },
      { section: 'manualTime', key: 'requiresApproval', label: 'Manual time needs approval', kind: b },
      { section: 'manualTime', key: 'reasonRequired', label: 'Reason required', kind: b },
    ],
  },
  {
    key: 'timeEdits',
    title: 'Time edits',
    fields: [
      { section: 'timeEdits', key: 'workerCanEdit', label: 'Members can edit their own time', kind: b },
      { section: 'timeEdits', key: 'reasonRequired', label: 'Reason required for edits', kind: b },
    ],
  },
];

export function displayPolicyValue(field: PolicyField, v: unknown): string {
  const k = field.kind;
  if (v === undefined) return '—';
  switch (k.type) {
    case 'bool':
      return v ? 'On' : 'Off';
    case 'select':
      return k.options.find((o) => o.value === v)?.label ?? String(v);
    case 'numselect':
      return k.options.find((o) => o.value === v)?.label ?? String(v);
    case 'number':
      return `${v} ${k.unit}`;
    case 'hours':
      return v === null ? 'No limit' : `${Math.round((Number(v) / 3600) * 100) / 100} h`;
    case 'domains': {
      const list = Array.isArray(v) ? (v as string[]) : [];
      return list.length ? list.slice(0, 3).join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '') : 'None';
    }
  }
}
