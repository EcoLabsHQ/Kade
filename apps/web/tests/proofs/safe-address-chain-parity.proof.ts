import { describe, expect, it } from 'vitest';
import { CHAIN_IDS } from '@kade/shared';
import { initSafe4337Pack } from '@/lib/safe/execute-safe-4337-env';
import {
  passkeyVerifierAddress,
  type PasskeySigner,
} from '@/lib/safe/passkey-signer';

/**
 * OPT-IN PROOF — requires network. **Not** run by `./scripts/verify.sh`.
 *
 * Run it with:
 *
 *   scripts/safe-chain-parity/run.sh
 *
 * which loads the RPC endpoints from `apps/web/.env.local` (or the environment)
 * and runs this file through the dedicated
 * `scripts/safe-chain-parity/vitest.config.ts`.
 *
 * ## What it proves, and why it is opt-in
 *
 * The iteration's single most important requirement is that **the resident Safe
 * address is chain-independent**: the same passkey must predict the same Safe on
 * every chain, so a resident who starts on Sepolia and later deposits on mainnet
 * owns the same account. `tests/safe-4337-singleton-pin.test.ts` pins the two
 * chain-dependent inputs offline, but it mocks both Safe SDKs, so on its own it
 * cannot prove the real SDK agrees across chains.
 *
 * This file closes that gap with the **real** `@safe-global/relay-kit` and
 * `@safe-global/protocol-kit` against **real RPC endpoints**: it initialises the
 * app's own create-Safe path (`initSafe4337Pack`) on chain 1 and chain 11155111
 * and asserts the predicted Safe addresses are byte-for-byte equal. It fails
 * loudly (a thrown, labelled assertion) if they differ. A passkey is
 * deterministic only if its coordinates are, so a fixed test credential is used;
 * the identity of the credential does not matter, only that both chains agree.
 */

/** Chain 1 — Ethereum mainnet, the frozen vault rail. */
const ETHEREUM = CHAIN_IDS.ethereum;
/** Chain 11155111 — Sepolia, the testnet the tooling still runs on. */
const SEPOLIA = CHAIN_IDS.sepolia;

/**
 * A fixed, synthetic passkey. The coordinates and raw id are arbitrary but
 * constant, so the only variable left between the two predictions is the chain.
 * `verifierAddress` is the repository's own P-256 verifier, not a guess.
 */
const PROOF_SIGNER: PasskeySigner = {
  rawId: 'aabbccddeeff00112233445566778899',
  coordinates: { x: '1', y: '2' },
  verifierAddress: passkeyVerifierAddress(),
};

/** Read a required RPC variable, or fail loudly naming what is missing. */
function requireRpc(variable: string): string {
  const value = process.env[variable]?.trim();
  if (!value) {
    throw new Error(
      `${variable} is not set. This proof talks to real chains; set the RPC ` +
        'endpoints (see apps/web/.env.example) or run ' +
        'scripts/safe-chain-parity/run.sh, which loads apps/web/.env.local.',
    );
  }
  return value;
}

/**
 * Derive the predicted Safe address on one chain through the app's real create
 * path.
 *
 * `bundlerUrl` is set to the chain's RPC endpoint: address prediction makes no
 * bundler request, and the RPC answers the one relay-kit call made during init
 * (`eth_chainId`). The prediction itself uses the real provider for the
 * on-chain reads the SDK performs, which is what makes the counterfactual
 * address chain-accurate.
 */
async function predictedSafeAddress(
  chainId: number,
  rpcUrl: string,
): Promise<string> {
  const pack = await initSafe4337Pack({
    chainId,
    signer: PROOF_SIGNER,
    safeAddress: null,
    bundlerUrl: rpcUrl,
  });
  const address = await pack.protocolKit?.getAddress();
  if (!address) {
    throw new Error(
      `The SDK returned no predicted Safe address on chain ${chainId}.`,
    );
  }
  return address;
}

describe('Safe address is chain-independent (opt-in, real RPCs)', () => {
  it('predicts the same Safe address on Ethereum mainnet and Sepolia', async () => {
    const ethereum = await predictedSafeAddress(
      ETHEREUM,
      requireRpc('ETHEREUM_RPC_URL'),
    );
    const sepolia = await predictedSafeAddress(
      SEPOLIA,
      requireRpc('SEPOLIA_RPC_URL'),
    );

    expect(ethereum).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(sepolia).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // Loud, labelled failure when the requirement is violated.
    expect(
      sepolia,
      `The predicted Safe address is chain-dependent: chain ${ETHEREUM} gave ` +
        `${ethereum} but chain ${SEPOLIA} gave ${sepolia}. The chain-independent ` +
        'Safe requirement is broken.',
    ).toBe(ethereum);
  }, 180_000);
});
