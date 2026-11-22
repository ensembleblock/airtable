// @ts-check

/**
 * Vitest config.
 *
 * Coverage is collected only by `npm run test:coverage` (also run by
 * `npm run check` & CI), which fails if coverage drops below the thresholds.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: [`src/**/*.ts`],
      provider: `v8`,
      reporter: [`text`, `html`],

      // Branches aren't 100%: `Object.entries(where)[0] ?? []` keeps a
      // fallback that `noUncheckedIndexedAccess` requires but that can't run
      // after `where` is checked to have exactly one key.
      thresholds: {
        branches: 99,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
