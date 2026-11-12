import { describe, expect, it } from 'vitest';
import { databaseErrorCause, isDatabaseBusy, problemFromError } from '../src/lib/http';

/**
 * QA audit, 11 Nov 2026 (BUG-01). Production returned bursts of 500s on unrelated read endpoints. The
 * Vercel log for one (request 01a1c705-…, 10 Nov 19:53:23 UTC) shows the request's first query failing
 * before it ever got a connection (db_queries 0, db_connects 0), logged only as Drizzle's wrapper,
 * "Failed query: select … from user_sessions …": the driver's own error, on `cause`, was never logged.
 *
 * A connection the database or its pooler refuses or drops is the service being briefly unavailable,
 * not a bug: a 503 with Retry-After, which the web app retries. And the log now names the real error.
 */
const drizzle = (cause: unknown) => Object.assign(new Error('Failed query: select "id" from "user_sessions" where …\nparams: …'), { cause });
const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });
const nodeError = (code: string, message: string) => Object.assign(new Error(message), { code, errno: -1, syscall: 'connect' });

describe('a refused or dropped database connection is a 503, not a 500', () => {
  const unavailable = [
    pgError('53300', 'sorry, too many clients already'),
    pgError('08006', 'connection failure'),
    pgError('08001', 'unable to connect'),
    pgError('57P01', 'terminating connection due to administrator command'),
    pgError('57P03', 'the database system is starting up'),
    pgError('XX000', '(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15'),
    nodeError('ECONNRESET', 'read ECONNRESET'),
    nodeError('ECONNREFUSED', 'connect ECONNREFUSED 10.0.0.1:5432'),
    nodeError('ETIMEDOUT', 'connect ETIMEDOUT'),
    new Error('Connection terminated unexpectedly'),
    new Error('Connection terminated due to connection timeout'),
    new Error('Client has encountered a connection error and is not queryable'),
  ];

  it.each(unavailable.map((e) => [e.message, e]))('%s, as Drizzle wraps it', (_m, e) => {
    for (const err of [e, drizzle(e)]) {
      expect(isDatabaseBusy(err)).toBe(true);
      expect(problemFromError(err, 'r1')).toMatchObject({ status: 503, code: 'service_busy' });
    }
  });

  it('a real mistake is still a 500', () => {
    for (const err of [new Error('Cannot read properties of undefined'), drizzle(pgError('42703', 'column "nope" does not exist')), drizzle(pgError('XX000', 'some internal error'))]) {
      expect(isDatabaseBusy(err)).toBe(false);
      expect(problemFromError(err, 'r1')).toMatchObject({ status: 500, code: 'internal_error' });
    }
  });
});

describe('databaseErrorCause: what the log needs to name the real error', () => {
  it('finds the driver error under Drizzle’s wrapper', () => {
    expect(databaseErrorCause(drizzle(pgError('53300', 'sorry, too many clients already')))).toEqual({ code: '53300', message: 'sorry, too many clients already' });
    expect(databaseErrorCause(drizzle(new Error('Connection terminated unexpectedly')))).toEqual({ code: null, message: 'Connection terminated unexpectedly' });
  });

  it('is null when nothing is wrapped, so ordinary errors log as before', () => {
    expect(databaseErrorCause(new Error('plain'))).toBeNull();
    expect(databaseErrorCause('not an error')).toBeNull();
  });

  it('never logs query parameters (they can be session hashes or personal data)', () => {
    const c = databaseErrorCause(drizzle(Object.assign(new Error('boom'), { code: 'XX000', detail: 'Key (email)=(a@b.c) exists', where: 'params: secret' })));
    expect(c).toEqual({ code: 'XX000', message: 'boom' });
  });
});
