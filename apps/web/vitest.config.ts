import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Two `vite` copies are installed in this workspace (the version vitest
 * resolves and the version `@vitejs/plugin-react` resolves), so their `Plugin`
 * types are structurally identical but nominally unrelated. Cast through
 * vitest's own re-exported `Plugin` type to bridge that identity gap.
 */
const reactPlugin = react({ jsxRuntime: 'automatic' }) as unknown as Plugin;

export default defineConfig({
  plugins: [reactPlugin],
  // The app tsconfig uses `jsx: "preserve"` (required by Next). Tests need the
  // automatic JSX runtime, so pin it for the esbuild transform as well.
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    globals: false,
    /**
     * The default 5000 ms is CPU-sensitive: several suites (notably
     * `onboarding-flow.test.tsx`) run near the limit on an idle machine and
     * exceed it when the suite runs in parallel or the machine is loaded, so the
     * mechanical gate failed on load rather than on behaviour. A timeout asserts
     * nothing about correctness — it only decides how long we wait — so raising
     * it makes the gate measure the behaviour it is meant to measure. It is not
     * a weakened assertion: every `expect` is unchanged.
     */
    testTimeout: 20000,
  },
});
