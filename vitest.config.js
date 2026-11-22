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

      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
