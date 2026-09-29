import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Opt-in proof configuration — **not** part of `./scripts/verify.sh`.
 *
 * It exists so the real-chain Safe-address equality proof
 * (`apps/web/tests/proofs/safe-address-chain-parity.proof.ts`) can be run on
 * demand, with network, without the default `tests/**\/*.test.{ts,tsx}` glob
 * ever collecting it. The `*.proof.ts` extension keeps it out of the app's own
 * `vitest run`.
 *
 * Run it through `scripts/safe-chain-parity/run.sh`, which supplies the RPC
 * environment. Running it directly needs `ETHEREUM_RPC_URL` and
 * `SEPOLIA_RPC_URL` set.
 */
export default defineConfig({
  root: fileURLToPath(new URL('../../apps/web', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../apps/web/src', import.meta.url)),
      '@kade/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/proofs/**/*.proof.ts'],
    environment: 'node',
    // Real RPC round-trips and SDK initialisation; give them room.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    reporters: ['default'],
    passWithNoTests: false,
  },
});
