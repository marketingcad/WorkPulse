import type { TrackingPolicy } from '@tallywork/domain';

/** One line of "What WorkPulse records": what it is, whether it is on, and the detail in plain words. */
export interface DisclosureItem {
  key: 'time' | 'activity' | 'screenshots' | 'apps' | 'websites' | 'idle';
  label: string;
  on: boolean;
  detail: string;
}

/**
 * What the desktop app records for this worker, from the organization's policy and what this
 * computer allows. Shown in the app so the worker sees it before and while tracking. Monitoring
 * runs only while clocked in (not paused, on a break or clocked out); see Agent.startMonitors.
 */
export function trackingDisclosure(policy: TrackingPolicy, capabilities: Record<string, boolean>): DisclosureItem[] {
  const unavailable = ' This computer does not allow it, so nothing is recorded.';
  const shots = policy.screenshots;
  const shotsOn = shots.enabled && shots.perTenMinutes > 0;
  const urls = policy.urls;
  const idle = policy.idle;
  return [
    { key: 'time', label: 'Time', on: true, detail: 'When you clock in and out, your breaks, and the project and task you pick.' },
    {
      key: 'activity',
      label: 'Activity level',
      on: policy.activity.enabled && capabilities.input !== false,
      detail: policy.activity.enabled ? `How much you use the keyboard and mouse, as counts. What you type is never recorded.${capabilities.input === false ? unavailable : ''}` : 'Not recorded by your organization.',
    },
    {
      key: 'screenshots',
      label: 'Screenshots',
      on: shotsOn && capabilities.screenshots !== false,
      detail: shotsOn
        ? `${shots.perTenMinutes} every 10 minutes, of every screen${shots.blur ? ', blurred on this computer before they are sent' : ''}.${shots.notify ? ' You get a notice each time.' : ''}${capabilities.screenshots === false ? unavailable : ''}`
        : 'Not taken.',
    },
    {
      key: 'apps',
      label: 'Apps',
      on: policy.apps.enabled && capabilities.apps !== false,
      detail: policy.apps.enabled ? `The names of the apps you use, and for how long.${capabilities.apps === false ? unavailable : ''}` : 'Not recorded by your organization.',
    },
    {
      key: 'websites',
      label: 'Websites',
      on: urls.enabled && capabilities.urls !== false,
      detail: urls.enabled
        ? `${urls.mode === 'full' ? 'The full address of the web pages you visit' : 'The websites you visit, by site name only (like example.com)'}, and for how long.${urls.excludedDomains.length ? ` ${urls.excludedDomains.length} ${urls.excludedDomains.length === 1 ? 'site is' : 'sites are'} never recorded.` : ''}${capabilities.urls === false ? unavailable : ''}`
        : 'Not recorded by your organization.',
    },
    {
      key: 'idle',
      label: 'Time away',
      on: idle.enabled,
      detail: idle.enabled
        ? `After ${idle.thresholdMinutes} ${idle.thresholdMinutes === 1 ? 'minute' : 'minutes'} without keyboard or mouse use, ${idle.behavior === 'pause' ? 'the timer pauses' : idle.behavior === 'keep' ? 'the time still counts as work' : 'you are asked whether that time was work'}.`
        : 'Time without keyboard or mouse use still counts as work.',
    },
  ];
}
