import type { TimeTypeDto } from '@tallywork/contracts';

/**
 * A time type's short name on its colour. Its own module so pages that only show the badge (time
 * entries, timesheets) don't load the time-types settings panel and its editors.
 */
export function TimeTypeBadge({ type }: { type: Pick<TimeTypeDto, 'short_name' | 'name' | 'color'> }) {
  return (
    <span title={type.name} className="inline-flex h-5 items-center rounded-sm px-1.5 text-2xs font-semibold text-white" style={{ background: type.color }}>
      {type.short_name}
    </span>
  );
}
