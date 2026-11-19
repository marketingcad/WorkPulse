import { afterEach, describe, expect, it } from 'vitest';
import { fmtDateTime, fmtTime, setDefaultTimeZone } from '../src';

// Times that name no zone follow the signed-in person's profile zone once the app sets it, so every page
// shows the same clock (QA, BUG-34: the Live page and the session drawer showed the browser's zone while
// the rest of the app showed the profile's).
const AT = '2026-11-20T15:30:00.000Z';

afterEach(() => setDefaultTimeZone(null));

describe('the default time zone', () => {
  it('is used when the caller names no zone', () => {
    setDefaultTimeZone('Asia/Manila');
    expect(fmtTime(AT)).toBe(fmtTime(AT, 'Asia/Manila'));
    expect(fmtTime(AT)).toMatch(/11:30/);
    expect(fmtDateTime(AT)).toBe(fmtDateTime(AT, 'Asia/Manila'));
  });

  it('never overrides a zone the caller names', () => {
    setDefaultTimeZone('Asia/Manila');
    expect(fmtTime(AT, 'UTC')).toMatch(/3:30/);
  });

  it('falls back to the browser zone when unset or blank', () => {
    setDefaultTimeZone('');
    const browser = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(AT));
    expect(fmtTime(AT)).toBe(browser);
  });
});
