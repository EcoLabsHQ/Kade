import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Acceptance suite.
 *
 * Tests in tests/acceptance/ encode the frozen Week 1 acceptance criteria from
 * docs/week-1-frozen-delivery-contract.md. They are the executable form of the
 * contract: a change that breaks one of them is a scope or invariant change,
 * which requires change control.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@kade/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/acceptance/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
});
