import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  readEvmChainBalances,
  type EvmReadFailure,
} from '@/lib/wealth/evm';
import {
  aggregateHoldings,
  classifyWalletRows,
  type HoldingsAggregate,
  type WalletLinkRow,
} from '@/lib/wealth/holdings';
import {
  CONNECTED_WALLET_PROVIDER,
  EVM_PROVIDER,
  type EvmChainBalance,
} from '@/lib/wealth/types';

/**
 * The Holdings data path, server-side only.
 *
 * Frozen decision §2.2 item 3 (as amended v1.3): a pasted EVM address is shown
 * in Holdings unverified and excluded from the total, while a pasted Bitcoin
 * address never feeds Holdings. As amended v1.2, a wallet connected during
 * onboarding is likewise shown unverified and excluded from the total. This
 * loader therefore asks Supabase for the resident's rows where `verified_at` is
 * set **or** the provider is `connected-wallet` or `pasted-address`, and then
 * runs every row through `classifyWalletRows`, so the structural predicate is
 * applied even if the query were ever loosened. Balances are read from the
 * existing public EVM provider (`@/lib/wealth/evm`), the same one the
 * proof-of-wealth screen uses, so the two cannot disagree. Nothing is
 * fabricated: a read that fails becomes that wallet's `readError`.
 */

interface WalletRow {
  readonly id: number;
  readonly address: string;
  readonly chain: number;
  readonly provider: string | null;
  readonly verified_at: string | null;
}

/** Project the snake_case Supabase row onto the domain row. */
export function toWalletLinkRows(rows: readonly WalletRow[]): WalletLinkRow[] {
  return rows.map((row) => ({
    id: row.id,
    address: row.address,
    chain: row.chain,
    provider: row.provider,
    verifiedAt: row.verified_at,
  }));
}

/** Read and total one verified address's EVM balances via the shared provider. */
async function readVerifiedBalances(address: string) {
  const reads = await readEvmChainBalances(address);

  const chains: EvmChainBalance[] = [];
  const failures: EvmReadFailure[] = [];
  for (const read of reads) {
    if (read.ok && read.balance) {
      chains.push(read.balance);
    } else if (read.failure) {
      failures.push(read.failure);
    }
  }

  const values = chains
    .map((chain) => chain.usd)
    .filter((value): value is number => value !== null);

  // Never fabricate a zero for a chain that failed: the readable figures are
  // summed, and every unread chain keeps its specific reason so the screen can
  // show it instead of a dead end.
  return {
    chains,
    usd: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0),
    failures,
  };
}

/**
 * Aggregate the signed-in resident's verified and unverified holdings.
 *
 * The query selects a row when it is signature-verified (any provider) or when
 * it is a `connected-wallet` or `pasted-address` row; pasted Bitcoin rows are
 * never returned. The structural classifier then partitions them, so a
 * `bitcoin-address` row is dropped even if the query were ever loosened. Returns
 * an empty aggregate (rather than throwing) for a resident with no such rows or
 * no session, so the screen degrades to "nothing linked yet".
 */
export async function loadVerifiedHoldings(
  userId: string,
): Promise<HoldingsAggregate> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from('wallets')
    .select('id, address, chain, provider, verified_at')
    .eq('profile_id', userId)
    .or(
      [
        'verified_at.not.is.null',
        `provider.eq.${CONNECTED_WALLET_PROVIDER}`,
        `provider.eq.${EVM_PROVIDER}`,
      ].join(','),
    )
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Reading the verified wallets failed: ${error.message}`);
  }

  const { verified, unverifiedWallets } = classifyWalletRows(
    toWalletLinkRows((data ?? []) as readonly WalletRow[]),
  );

  return aggregateHoldings({
    wallets: verified,
    unverifiedWallets,
    readBalances: readVerifiedBalances,
  });
}
