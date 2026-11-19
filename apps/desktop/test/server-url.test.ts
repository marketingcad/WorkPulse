import { describe, expect, it } from 'vitest';
import { IPC } from '../src/shared/ipc';
import { isSecureServerUrl } from '../src/shared/server-url';

/**
 * Form validation audit, 20 Nov 2026: the sign-in screen accepted a plain http:// server address, so a
 * password could be sent unencrypted. Only https, or http on this computer (local testing), is allowed.
 */
describe('server address', () => {
  it.each([
    ['https://app.workpulse.example', true],
    ['  https://app.workpulse.example/  ', true],
    ['http://localhost:3101', true],
    ['http://127.0.0.1:3000', true],
    ['http://[::1]:3000', true],
    ['http://app.workpulse.example', false],
    ['http://192.168.1.20:3000', false],
    ['ftp://app.workpulse.example', false],
    ['app.workpulse.example', false],
    ['', false],
  ])('%s → %s', (url, ok) => {
    expect(isSecureServerUrl(url)).toBe(ok);
  });

  it('is enforced by the main process for both ways of signing in', () => {
    const login = { email: 'ada@example.com', password: 'x' };
    expect(IPC['auth:loginPassword'].safeParse({ ...login, serverUrl: 'http://app.workpulse.example' }).success).toBe(false);
    expect(IPC['auth:loginPassword'].safeParse({ ...login, serverUrl: 'https://app.workpulse.example' }).success).toBe(true);
    expect(IPC['auth:login'].safeParse({ serverUrl: 'http://app.workpulse.example' }).success).toBe(false);
    expect(IPC['auth:login'].safeParse({ serverUrl: 'http://localhost:3101' }).success).toBe(true);
  });
});
