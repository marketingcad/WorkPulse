import { defineConfig } from 'vitest/config';

/** Unit tests for the tutorial's timing logic (`pnpm --filter @tallywork/e2e tutorial:test`). Not Playwright. */
export default defineConfig({
  root: import.meta.dirname,
  test: { include: ['test/**/*.test.ts'] },
});
