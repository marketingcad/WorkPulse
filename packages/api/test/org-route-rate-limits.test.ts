import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Organization routes run inside the request's tenant transaction (app.ts mounts `tenant` on
 * /orgs/:orgId/* before them). The rateLimit middleware writes through the shared connection, so
 * inside that transaction it waits forever on a single-connection database: an invoice reminder
 * route did exactly that and hung the E2E server, while Vitest (rate limits off) stayed green.
 * Limits on these routes belong in the service, counted in the same transaction.
 */
const ORG_ROUTE_FILES = ['org.ts', 'time.ts', 'ops-finance.ts', 'insight-platform.ts'];

describe('organization routes', () => {
  it.each(ORG_ROUTE_FILES)('%s does not use the rateLimit middleware', (file) => {
    const src = readFileSync(path.resolve(__dirname, '../src/routes', file), 'utf8');
    expect(src).not.toMatch(/\brateLimit\(/);
  });

  it('every router app.ts mounts under /orgs/:orgId is checked here', () => {
    const app = readFileSync(path.resolve(__dirname, '../src/app.ts'), 'utf8');
    const mounted = [...app.matchAll(/app\.route\('\/orgs\/:orgId', (\w+)\)/g)].map((m) => m[1]);
    const routes = path.resolve(__dirname, '../src/routes');
    const owners = mounted.map((name) => ORG_ROUTE_FILES.find((f) => new RegExp(`export const ${name}\\b`).test(readFileSync(path.join(routes, f), 'utf8'))));
    expect(owners.every(Boolean), `routers mounted under /orgs/:orgId: ${mounted.join(', ')}`).toBe(true);
  });
});
