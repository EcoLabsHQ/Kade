import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Regression suite.
 *
 * Tests in tests/regressions/ encode behaviour that previously failed and must
 * never silently fail again. See docs/DEVELOPMENT_CONTRACT.md section 14 and
 * scripts/regression/README.md.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@kade/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/regressions/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
    // The suite is intentionally empty until the first reproducible bug is
    // fixed (docs/DEVELOPMENT_CONTRACT.md section 3). verify.sh reports the
    // collected count so an empty suite is visible rather than silently green.
    passWithNoTests: true,
  },
});
