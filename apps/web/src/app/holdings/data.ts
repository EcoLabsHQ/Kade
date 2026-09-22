import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readEvmBalances } from '@/lib/wealth/evm';
import {
  aggregateHoldings,
  selectVerifiedWallets,
  type HoldingsAggregate,
  type WalletLinkRow,
} from '@/lib/wealth/holdings';

/**
 * The Holdings data path, server-side only.
 *
 * Frozen decision §2.2 item 3: pasted addresses never feed Holdings. This loader
 * asks Supabase for the resident's rows where `verified_at` is set — the column
 * front 03 writes **only** for a signature-verified row — and then runs the same
 * rows through `selectVerifiedWallets`, so the structural predicate is applied
 * even if the query were ever loosened. Balances are read from the existing
 * public EVM provider (`@/lib/wealth/evm`), the same one the proof-of-wealth
 * screen uses, so the two cannot disagree. Nothing is fabricated: a read that
 * fails becomes that wallet's `readError`.
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
  const chains = await readEvmBalances(address);
  const values = chains
    .map((chain) => chain.usd)
    .filter((value): value is number => value !== null);
  return {
    chains,
    usd: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0),
  };
}

/**
 * Aggregate the signed-in resident's verified-wallet holdings.
 *
 * Returns an empty aggregate (rather than throwing) for a resident with no
 * verified rows or no session, so the screen degrades to "nothing linked yet".
 */
export async function loadVerifiedHoldings(
  userId: string,
): Promise<HoldingsAggregate> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from('wallets')
    .select('id, address, chain, provider, verified_at')
    .eq('profile_id', userId)
    .not('verified_at', 'is', null)
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Reading the verified wallets failed: ${error.message}`);
  }

  const wallets = selectVerifiedWallets(
    toWalletLinkRows((data ?? []) as readonly WalletRow[]),
  );

  return aggregateHoldings({
    wallets,
    readBalances: readVerifiedBalances,
  });
}
