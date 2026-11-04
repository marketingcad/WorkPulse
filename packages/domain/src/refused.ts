/**
 * Why the server refused time (or data) a desktop app recorded, in plain words: one wording for the
 * worker's app ("Not added to your time", `worker`) and for managers' "Time not added" (`manager`).
 * `data` names refused monitoring data ("Screenshots") when the reason is a monitor turned off.
 */
export function refusedReason(code: string, message: string, opts: { audience: 'worker' | 'manager'; data?: { label: string; plural: boolean } }): string {
  const w = opts.audience === 'worker';
  switch (code) {
    case 'forbidden':
      return w ? 'You are no longer on this project.' : 'The member is no longer on this project.';
    case 'project_not_found':
      return 'The project was removed or archived.';
    case 'task_not_found':
      return 'The task was removed or archived, or moved to another project.';
    case 'session_not_found':
      return 'The start of this session was not accepted, so the rest of it could not be added.';
    case 'project_inactive':
      return 'The project is no longer active.';
    case 'desktop_tracking_disabled':
    case 'tracking_disabled':
      return w ? 'Your organization turned off time tracking from the desktop app for you.' : 'Time tracking from the desktop app is turned off for this member.';
    case 'session_stopped':
      return w
        ? 'This session had already been stopped: by your manager, by a time limit, or because you were offline too long.'
        : 'This session had already been stopped: by a manager, by a time limit, or because the computer was offline too long.';
    case 'activity_disabled':
    case 'apps_disabled':
    case 'urls_disabled':
    case 'screenshots_disabled':
      return `${w ? 'Your organization' : 'The organization'} turned this off, so ${(opts.data?.label ?? 'this data').toLowerCase()} recorded meanwhile ${opts.data?.plural ? 'were' : 'was'} not kept.`;
    default:
      return message || 'The server did not accept it.';
  }
}
