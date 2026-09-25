import { and, asc, gt, inArray } from 'drizzle-orm';
import { outboxEvents, withTenant } from '@tallywork/db';
import { isUuid, newId } from '@tallywork/domain';
import type { Ctx } from './ctx';
import { narrowMemberships } from './scope';

/** Events that change what live views show. Each carries the worker it is about. */
export const STREAM_EVENTS = [
  'session.started',
  'session.paused',
  'session.resumed',
  'session.stopped',
  'session.interrupted',
  'session.recovered',
  'time.changed',
  'idle.started',
  'screenshot.captured',
  'timesheet.submitted',
  'timesheet.approved',
  'timesheet.rejected',
  'timesheet.changes_requested',
  'timesheet.reopened',
  'timesheet.late_time',
  'manual_time.requested',
  'time_off.requested',
];

export interface StreamItem {
  id: string;
  type: string;
  worker_id: string;
}

/**
 * A reader of the organization's event log for one viewer. Only event type and worker id are
 * sent (never payloads), and only for workers the viewer may see; clients refetch what changed.
 */
export function eventReader(x: Ctx, lastEventId?: string | null) {
  const visible = narrowMemberships(x.actor, 'time:read');
  let cursor = lastEventId && isUuid(lastEventId) ? lastEventId : newId();
  const { db } = x.deps;
  const orgId = x.org.id;
  return {
    get cursor() {
      return cursor;
    },
    /** New events since the last read, in order. Each read is its own short transaction. */
    async next(): Promise<StreamItem[]> {
      const rows = await withTenant(db, orgId, (tx) =>
        tx
          .select({ id: outboxEvents.id, type: outboxEvents.eventType, envelope: outboxEvents.envelope })
          .from(outboxEvents)
          .where(and(gt(outboxEvents.id, cursor), inArray(outboxEvents.eventType, STREAM_EVENTS)))
          .orderBy(asc(outboxEvents.id))
          .limit(200),
      );
      const out: StreamItem[] = [];
      for (const r of rows) {
        cursor = r.id;
        const worker = (r.envelope as { worker_id?: string | null }).worker_id;
        if (!worker || (visible !== 'all' && !visible.includes(worker))) continue;
        out.push({ id: r.id, type: r.type, worker_id: worker });
      }
      return out;
    },
  };
}
