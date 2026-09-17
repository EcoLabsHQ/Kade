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
  },
});
