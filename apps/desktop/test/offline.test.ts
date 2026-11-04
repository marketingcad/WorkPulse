import { describe, expect, it } from 'vitest';
import { expiredMessage, offlineStatus } from '../src/shared/offline';
import { notAddedItems, type RejectedRecord } from '../src/shared/not-added';

const H = 3600_000;
const base = { fromCache: false, settingsSavedAt: null, totalsPartial: false, maxOfflineHours: 24 };

describe('offlineStatus', () => {
  it('is online when the server answers, and says when running from saved settings', () => {
    expect(offlineStatus({ ...base, online: true, lastContactAt: 0, now: 100 * H }).mode).toBe('online');
    expect(offlineStatus({ ...base, online: false, fromCache: true, settingsSavedAt: 0, lastContactAt: 0, now: 1 * H }).settingsSavedAt).toBe(new Date(0).toISOString());
  });

  it('allows offline tracking until max offline hours after the last contact, then expires', () => {
    const at = (h: number) => offlineStatus({ ...base, online: false, lastContactAt: 0, now: h * H });
    expect(at(23.9)).toMatchObject({ mode: 'offline', allowedUntil: new Date(24 * H).toISOString() });
    expect(at(24.1).mode).toBe('expired');
  });

  it('follows the organization limit', () => {
    expect(offlineStatus({ ...base, maxOfflineHours: 2, online: false, lastContactAt: 0, now: 3 * H }).mode).toBe('expired');
    expect(expiredMessage(1)).toMatch(/more than 1 hour,/);
  });
});

const rec = (r: Partial<RejectedRecord>): RejectedRecord => ({ account: 'o:m', eventId: Math.random().toString(36), type: 'session.start', sessionId: 's1', projectId: null, taskId: null, occurredAt: '2026-11-01T09:00:00.000Z', code: 'x', message: 'm', rejectedAt: '2026-11-02T00:00:00.000Z', ...r });

describe('notAddedItems', () => {
  it('turns a refused offline session into one item with its span and a plain reason', () => {
    const items = notAddedItems([
      rec({ type: 'session.start', projectId: 'p', code: 'forbidden', occurredAt: '2026-11-01T09:00:00.000Z' }),
      rec({ type: 'activity.minutes', code: 'session_not_found', occurredAt: '2026-11-01T09:10:00.000Z' }),
      rec({ type: 'session.stop', code: 'session_not_found', occurredAt: '2026-11-01T11:30:00.000Z' }),
    ]);
    expect(items).toEqual([{ id: 's1', kind: 'time', projectId: 'p', taskId: null, from: '2026-11-01T09:00:00.000Z', to: '2026-11-01T11:30:00.000Z', reason: 'You are no longer on this project.', count: 3 }]);
  });

  it('marks refused monitoring data as data, not lost time', () => {
    const [item] = notAddedItems([rec({ type: 'screenshot.captured', sessionId: 's2', code: 'screenshots_disabled' })]);
    expect(item).toMatchObject({ kind: 'data', reason: expect.stringMatching(/screenshots recorded meanwhile were not kept/) });
  });

  it('explains an archived project, and falls back to the server message', () => {
    expect(notAddedItems([rec({ code: 'project_not_found' })])[0]!.reason).toBe('The project was removed or archived.');
    expect(notAddedItems([rec({ code: 'limit_reached', message: 'You have reached your daily time limit' })])[0]!.reason).toBe('You have reached your daily time limit');
  });
});
