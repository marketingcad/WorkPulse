import { randomInt } from 'node:crypto';

/**
 * The address one invited person accepts from, as the `X-Real-IP` header of their own request context.
 *
 * In real life everyone accepts their invitation from their own computer. The tests used to accept every
 * invitation from this one machine, so a full run inside one clock hour went past the server's limit
 * (20 accepts per address per hour) and failed with 429. The limit is unchanged and still applies to each
 * address. Each person gets a random address from 198.18.0.0/15, a range reserved for testing networks,
 * so it can never be a real visitor's.
 *
 * Use it only for a context that stands for one new person. Tests of the limit itself, and tests that
 * join through the browser, keep the machine's own address.
 */
export function inviteeAddress(): { 'X-Real-IP': string } {
  const n = randomInt(1, 2 ** 17 - 1);
  return { 'X-Real-IP': `198.${18 + (n >> 16)}.${(n >> 8) & 255}.${n & 255}` };
}
