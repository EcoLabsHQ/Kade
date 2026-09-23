'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  EVM_READ_CHAINS,
  EvmReadError,
  normalizeEvmAddress,
  readEvmBalances,
} from '@/lib/wealth/evm';
import {
  BITCOIN_CHAIN_ID,
  CONNECTED_WALLET_PROVIDER,
  EVM_PROVIDER,
  MAX_WALLET_ADDRESSES,
  type EvmAddressRecord,
  type EvmChainBalance,
} from '@/lib/wealth/types';

/**
 * EVM watch-only addresses, managed on the server.
 *
 * The browser never calls the balance provider and never writes the database:
 * both go through these server actions. An address is validated, read from the
 * provider, then persisted through the SECURITY INVOKER RPCs in migration
 * 20260921000001/20260921000002, so row level security still applies as the
 * resident and the write never originates in the browser. Only the address is
 * stored, and it is stored once per chain `readEvmBalances` reads it on; the
 * balances are read fresh on every call, so the screen shows current values.
 *
 * Two encodings share that machinery: `addWalletAddress` writes the pasted
 * `pasted-address` provider, and `addConnectedWallet` writes
 * `connected-wallet`. Neither sets `verified_at`: the pasted row is excluded
 * from Holdings by construction, and the connected row is shown there only as
 * unverified and excluded from the total.
 *
 * A provider failure is not a persistence failure. A valid address is saved, its
 * record carries `readError`, and the figures stay null rather than being
 * fabricated.
 */

interface WalletRow {
  readonly id: number;
  readonly address: string;
}

interface StoredAddress {
  readonly id: number;
  readonly address: string;
}

/** Sum the readable per-chain USD figures, or null when none is known. */
function totalUsd(chains: readonly EvmChainBalance[]): number | null {
  const values = chains
    .map((chain) => chain.usd)
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

/**
 * Read the resident's stored EVM rows, oldest first. `chain <> 0` excludes the
 * Bitcoin sentinel and leaves both EVM encodings, one row per chain read.
 */
async function loadStoredAddresses(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
): Promise<readonly StoredAddress[]> {
  const { data, error } = await client
    .from('wallets')
    .select('id, address')
    .eq('profile_id', userId)
    .neq('chain', BITCOIN_CHAIN_ID)
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Reading the saved EVM addresses failed: ${error.message}`);
  }

  return ((data ?? []) as readonly WalletRow[]).map((row) => ({
    id: row.id,
    address: row.address,
  }));
}

/**
 * Read one address's balances fresh, turning a provider failure into the
 * record's `readError` instead of an exception, so one bad address cannot fail
 * a whole list.
 */
async function readAddressRecord(address: string): Promise<EvmAddressRecord> {
  try {
    const chains = await readEvmBalances(address);
    return {
      address,
      chains,
      usd: totalUsd(chains),
      readAt: new Date().toISOString(),
      readError: null,
    };
  } catch (cause) {
    console.warn('[kade] Could not read the EVM balances:', cause);
    return {
      address,
      chains: [],
      usd: null,
      readAt: null,
      readError:
        cause instanceof Error
          ? cause.message
          : 'The EVM balances could not be read.',
    };
  }
}

/**
 * Save a pasted or connected EVM address for the signed-in resident and return
 * its freshly read record.
 *
 * The only difference between the two callers is the `provider` that is written:
 * `pasted-address` for a hand-pasted address, `connected-wallet` for a wallet
 * connected through the browser extension or WalletConnect. Both go through the
 * same `record_wallet_address` RPC, the same validation and the same
 * distinct-address cap, and neither sets `verified_at` — that column belongs to
 * `record_wallet_ownership` alone. The 6th distinct address is refused with a
 * clear message.
 */
async function saveEvmAddress(
  address: string,
  provider: string,
): Promise<EvmAddressRecord> {
  // Canonicalise before validating and persisting, so the same address pasted in
  // another case is the same row rather than a second one.
  let normalized: string;
  try {
    normalized = normalizeEvmAddress(address);
  } catch (cause) {
    if (cause instanceof EvmReadError) {
      throw new Error('That is not a recognised EVM address.');
    }
    throw cause;
  }

  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('Saving an EVM address requires a signed-in session.');
  }

  const stored = await loadStoredAddresses(client, user.id);
  const distinct = new Set(stored.map((row) => row.address));
  if (!distinct.has(normalized) && distinct.size >= MAX_WALLET_ADDRESSES) {
    throw new Error(
      `You can save at most ${MAX_WALLET_ADDRESSES} EVM addresses. ` +
        'Remove one before adding another.',
    );
  }

  let chains: readonly EvmChainBalance[] = [];
  let readError: string | null = null;
  try {
    chains = await readEvmBalances(normalized);
  } catch (cause) {
    console.warn('[kade] Could not read the EVM balances:', cause);
    readError =
      cause instanceof Error
        ? cause.message
        : 'The EVM balances could not be read.';
  }

  // One row per chain the address is read on. When the read returned no chain
  // (a provider failure, or every chain skipped), fall back to every configured
  // chain so the address itself is still persisted.
  const chainIds =
    chains.length > 0
      ? chains.map((chain) => chain.chainId)
      : EVM_READ_CHAINS.map((chain) => chain.chainId);

  for (const chainId of chainIds) {
    const { error } = await client.rpc('record_wallet_address', {
      p_address: normalized,
      p_chain: chainId,
      p_provider: provider,
    });
    if (error) {
      throw new Error(`Saving the EVM address failed: ${error.message}`);
    }
  }

  return {
    address: normalized,
    chains,
    usd: totalUsd(chains),
    readAt: readError ? null : new Date().toISOString(),
    readError,
  };
}

/**
 * Save a **pasted** EVM address for the signed-in resident.
 *
 * Writes `pasted-address` with `verified_at` NULL, so the row is excluded from
 * Holdings by construction. Kept exactly as it was; the connected path is the
 * sibling below.
 */
export async function addWalletAddress(
  address: string,
): Promise<EvmAddressRecord> {
  return saveEvmAddress(address, EVM_PROVIDER);
}

/**
 * Save a **connected** EVM address (browser extension or WalletConnect).
 *
 * Week-2 contract v1.2: the connected account is persisted so it survives a
 * reload, with the distinct provider `connected-wallet` and `verified_at` NULL.
 * It is shown in Holdings as an unverified wallet and excluded from the total;
 * it is never marked verified, because a browser connection is not a signature.
 * Same validation, same RPC and same 5-address cap as the pasted path.
 */
export async function addConnectedWallet(
  address: string,
): Promise<EvmAddressRecord> {
  return saveEvmAddress(address, CONNECTED_WALLET_PROVIDER);
}


/**
 * Read one address's balances for a connected wallet, without persisting
 * anything.
 *
 * The proof-of-wealth step offers a real wallet connection as well as pasted
 * addresses. The balances for that connected account come from the same
 * provider and the same chain set as a pasted address, so the two paths cannot
 * disagree; nothing is written, because a connection proves the account is in
 * the browser, not that the server can verify it.
 */
export async function readAddressBalances(
  address: string,
): Promise<EvmAddressRecord> {
  let normalized: string;
  try {
    normalized = normalizeEvmAddress(address);
  } catch (cause) {
    if (cause instanceof EvmReadError) {
      throw new Error('That is not a recognised EVM address.');
    }
    throw cause;
  }

  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('Reading wallet balances requires a signed-in session.');
  }

  return readAddressRecord(normalized);
}

/** Remove every stored row of one of the resident's own EVM addresses. */
export async function removeWalletAddress(address: string): Promise<void> {
  const normalized = normalizeEvmAddress(address);

  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('Removing an EVM address requires a signed-in session.');
  }

  const { error } = await client.rpc('delete_wallet_addresses', {
    p_address: normalized,
  });
  if (error) {
    throw new Error(`Removing the EVM address failed: ${error.message}`);
  }
}

/**
 * List the resident's EVM addresses with fresh balances, one record per
 * address.
 *
 * Returns an empty list (rather than throwing) when there is no session, so the
 * screen degrades to "none" instead of erroring. A per-address provider failure
 * becomes that record's `readError` and never fails the list.
 */
export async function listWalletAddresses(): Promise<
  readonly EvmAddressRecord[]
> {
  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    return [];
  }

  const stored = await loadStoredAddresses(client, user.id);
  if (stored.length === 0) {
    return [];
  }

  const addresses = [...new Set(stored.map((row) => row.address))];
  return Promise.all(addresses.map((address) => readAddressRecord(address)));
}
