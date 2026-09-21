import { chainByChainId } from '@kade/shared';
import {
  safeDeploymentStore,
  type SafeDeploymentStatus,
} from '@/lib/safe/manifest';

/**
 * The resident's Safe, as the shell needs it.
 *
 * Read from the deployment record rather than derived on the fly: the record is
 * what proves the recovery inputs were stored, and it is the same row the
 * deployment writes to. A resident with no record has no account yet, and the
 * shell says so rather than showing a placeholder address.
 *
 * `status` is carried through so the shell can be specific about *why* a Safe is
 * not deployed (still predicted, or a recorded failure) rather than collapsing
 * both into a single "not deployed". The raw failure reason is not carried: it
 * is server-side diagnostics, not resident-facing language.
 *
 * Never throws. The shell is rendered on every authenticated page, so a database
 * problem must degrade to "no account yet" rather than take the page down.
 */
export interface ShellSafe {
  readonly address: string | null;
  readonly deployed: boolean;
  readonly explorerUrl: string | null;
  readonly status: SafeDeploymentStatus | null;
}

const NO_SAFE: ShellSafe = {
  address: null,
  deployed: false,
  explorerUrl: null,
  status: null,
};

/**
 * Block explorer for the chain the Safe is actually recorded on.
 *
 * This is deliberately the record's `deploymentChainId`, not the app's active
 * chain environment: the engine deploys on Ethereum Sepolia, so under a
 * mainnet `KADE_CHAIN_ENV` the app's "active" chain and the Safe's chain differ,
 * and a link built from the active chain would point at the wrong explorer for
 * an address that does not exist there.
 */
function explorerForChain(chainId: number): string | null {
  return chainByChainId(chainId)?.explorerUrl ?? null;
}

export async function loadShellSafe(profileId: string): Promise<ShellSafe> {
  try {
    const record = await safeDeploymentStore().getForProfile(profileId);
    if (!record) return NO_SAFE;
    return {
      address: record.safeAddress,
      deployed: record.status === 'deployed',
      explorerUrl: explorerForChain(record.manifest.deploymentChainId),
      status: record.status,
    };
  } catch (cause) {
    console.warn('[kade] could not read the Safe record for the shell:', cause);
    return NO_SAFE;
  }
}
