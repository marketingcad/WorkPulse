/**
 * The server the person signs in to: https, or plain http only on this computer (local testing). A
 * password must never be sent unencrypted over a network (form validation audit, 20 Nov 2026); managed
 * settings already followed this rule.
 */
export function isSecureServerUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}
