import { chainsForEnv } from '@kade/shared';
import { readChainEnv } from '@/lib/env';
import { safeDeploymentStore } from '@/lib/safe/manifest';

/**
 * The resident's Safe, as the shell needs it.
 *
 * Read from the deployment record rather than derived on the fly: the record is
 * what proves the recovery inputs were stored, and it is the same row the
 * deployment writes to. A resident with no record has no account yet, and the
 * shell says so rather than showing a placeholder address.
 *
 * Never throws. The shell is rendered on every authenticated page, so a database
 * problem must degrade to "no account yet" rather than take the page down.
 */
export interface ShellSafe {
  readonly address: string | null;
  readonly deployed: boolean;
  readonly explorerUrl: string | null;
}

const NO_SAFE: ShellSafe = { address: null, deployed: false, explorerUrl: null };

/** Block explorer for the active settlement chain, from the shared registry. */
function explorerBase(): string | null {
  const chains = chainsForEnv(readChainEnv());
  const ethereum = chains.find((chain) => chain.key === 'ethereum') ?? chains[0];
  return ethereum?.explorerUrl ?? null;
}

export async function loadShellSafe(profileId: string): Promise<ShellSafe> {
  try {
    const record = await safeDeploymentStore().getForProfile(profileId);
    if (!record) return NO_SAFE;
    return {
      address: record.safeAddress,
      deployed: record.status === 'deployed',
      explorerUrl: explorerBase(),
    };
  } catch (cause) {
    console.warn('[kade] could not read the Safe record for the shell:', cause);
    return NO_SAFE;
  }
}
