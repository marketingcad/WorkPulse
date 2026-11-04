import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NETWORK_ERROR, api } from '../lib/api';

// Audit 30 Oct 2026: a lost connection reads in plain words (VF-09); a 401 after the app had been
// working sends people to sign-in with the reason, and shows no error on the way (VF-11); a form's
// general alert shows the field errors it has no place for (VF-21).

const location = { pathname: '/o/org-1/clients', search: '?q=a', href: '' };

afterEach(() => {
  vi.unstubAllGlobals();
  location.href = '';
});

const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api() errors', () => {
  it('turns a failed connection into a readable ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api('/orgs/x/clients')).rejects.toMatchObject({ status: 0, code: 'network_error', title: NETWORK_ERROR });
  });

  it('lets a cancelled request stay a cancellation', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    await expect(api('/orgs/x/clients', { signal: ctrl.signal })).rejects.toBe(abort);
  });

  it('on a 401 after a success, goes to sign-in with reason=expired and never settles', async () => {
    vi.stubGlobal('window', { location });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(200, [])).mockResolvedValueOnce(reply(401, { title: 'Sign in to continue', code: 'unauthenticated' })));
    await api('/orgs/x/clients');
    const settled = vi.fn();
    void api('/orgs/x/clients', { body: { name: 'A' } }).then(settled, settled);
    await new Promise((r) => setTimeout(r, 20));
    expect(location.href).toBe(`/login?next=${encodeURIComponent('/o/org-1/clients?q=a')}&reason=expired`);
    expect(settled).not.toHaveBeenCalled();
  });

  it('keeps the readable server title and request id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(409, { title: 'A client with this name already exists', code: 'duplicate_name', request_id: 'r1' })));
    await expect(api('/orgs/x/clients', { body: {} })).rejects.toMatchObject({ status: 409, title: 'A client with this name already exists', requestId: 'r1' });
  });
});

describe('ApiError.general()', () => {
  it('is the title when there are no field errors', () => {
    expect(new ApiError(409, 'duplicate', 'This already exists').general(['name'])).toBe('This already exists');
  });

  it('lists only the field errors the form does not show', () => {
    const e = new ApiError(400, 'validation_error', 'Name: This field is required (and 1 more)', undefined, [
      { field: 'name', message: 'This field is required' },
      { field: 'timezone', message: 'Choose a valid time zone' },
    ]);
    expect(e.general(['name'])).toBe('Choose a valid time zone');
    expect(e.general(['name', 'timezone'])).toBeUndefined();
  });
});
