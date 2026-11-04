import { describe, expect, it } from 'vitest';
import { OFFLINE_MESSAGE, isNetworkError, plainError } from '../src/shared/errors';

describe('plainError', () => {
  it('replaces Chromium network codes and fetch failures with one plain sentence', () => {
    for (const m of ['net::ERR_INTERNET_DISCONNECTED', 'net::ERR_NAME_NOT_RESOLVED', 'fetch failed', 'getaddrinfo ENOTFOUND tallywork.app', 'connect ECONNREFUSED 127.0.0.1:3100']) expect(plainError(m)).toBe(OFFLINE_MESSAGE);
  });

  it('explains certificate failures separately', () => {
    expect(plainError('net::ERR_CERT_DATE_INVALID')).toMatch(/date and time/);
  });

  it('replaces bare status codes, and keeps messages the server wrote', () => {
    expect(plainError('Request failed (502)')).toMatch(/having a problem/);
    expect(plainError('Token refresh failed (503)')).toMatch(/having a problem/);
    expect(plainError('Request failed (429)')).toMatch(/Too many attempts/);
    expect(plainError('Request failed (404)')).toMatch(/didn’t work/);
    expect(plainError('You have reached your daily time limit')).toBe('You have reached your daily time limit');
    // A refusal the server explains (IP allowlist) is not mistaken for being offline.
    expect(plainError('Access to this organization is not allowed from your network')).toBe('Access to this organization is not allowed from your network');
  });
});

describe('isNetworkError', () => {
  it('is true for unreachable servers only', () => {
    expect(isNetworkError(new TypeError('fetch failed'))).toBe(true);
    expect(isNetworkError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(true);
    expect(isNetworkError(new Error('Request failed (500)'))).toBe(false);
  });
});
