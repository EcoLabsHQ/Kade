'use server';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readBitcoinApiBase } from '@/lib/env';
import { isBitcoinAddress, readBitcoinBalance } from '@/lib/wealth/bitcoin';
import {
  BITCOIN_CHAIN_ID,
  BITCOIN_PROVIDER,
  MAX_BITCOIN_ADDRESSES,
  type BitcoinAddressRecord,
} from '@/lib/wealth/types';

/**
 * Bitcoin watch-only addresses, managed on the server.
 *
 * The browser never calls the balance provider and never writes the database:
 * both go through these server actions. A pasted address is validated, read from
 * the provider, then persisted through the SECURITY INVOKER RPCs in migration
 * 20260921000001, so row level security still applies as the resident and the
 * write never originates in the browser. Only the address is stored; the balance
 * is read fresh on every call, so the screen shows current values.
 *
 * A provider failure is not a persistence failure. A valid address is saved and
 * its record carries `readError`; the balance figures stay null rather than
 * being fabricated.
 */

interface StoredAddress {
  readonly id: number;
  readonly address: string;
}

interface WalletRow {
  readonly id: number;
  readonly address: string;
}

/** Read the resident's stored Bitcoin addresses, oldest first. */
async function loadStoredAddresses(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
): Promise<readonly StoredAddress[]> {
  const { data, error } = await client
    .from('wallets')
    .select('id, address')
    .eq('profile_id', userId)
    .eq('chain', BITCOIN_CHAIN_ID)
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Reading the saved Bitcoin addresses failed: ${error.message}`);
  }

  return ((data ?? []) as readonly WalletRow[]).map((row) => ({
    id: row.id,
    address: row.address,
  }));
}

/**
 * Read one balance, turning a provider failure into the record's `readError`
 * instead of an exception, so one bad address cannot fail a whole list.
 */
async function readAddressRecord(
  id: number,
  address: string,
  baseUrl: string,
): Promise<BitcoinAddressRecord> {
  try {
    const read = await readBitcoinBalance(address, { baseUrl });
    return {
      id,
      address,
      btc: read.btc,
      usd: read.usd,
      readAt: new Date().toISOString(),
      readError: null,
    };
  } catch (cause) {
    console.warn('[kade] Could not read the Bitcoin balance:', cause);
    return {
      id,
      address,
      btc: null,
      usd: null,
      readAt: null,
      readError:
        cause instanceof Error
          ? cause.message
          : 'The Bitcoin balance could not be read.',
    };
  }
}

/**
 * Save a pasted Bitcoin address for the signed-in resident and return its
 * freshly read record. The 6th address is refused with a clear message.
 */
export async function addBitcoinAddress(
  address: string,
): Promise<BitcoinAddressRecord> {
  if (!isBitcoinAddress(address)) {
    throw new Error('That is not a recognised Bitcoin address.');
  }

  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('Saving a Bitcoin address requires a signed-in session.');
  }

  const stored = await loadStoredAddresses(client, user.id);
  const alreadyStored = stored.some((row) => row.address === address);
  if (!alreadyStored && stored.length >= MAX_BITCOIN_ADDRESSES) {
    throw new Error(
      `You can save at most ${MAX_BITCOIN_ADDRESSES} Bitcoin addresses. ` +
        'Remove one before adding another.',
    );
  }

  const { data: id, error } = await client.rpc('record_wallet_address', {
    p_address: address,
    p_chain: BITCOIN_CHAIN_ID,
    p_provider: BITCOIN_PROVIDER,
  });
  if (error) {
    throw new Error(`Saving the Bitcoin address failed: ${error.message}`);
  }

  return readAddressRecord(Number(id), address, readBitcoinApiBase());
}

/** Remove one of the resident's own Bitcoin addresses. */
export async function removeBitcoinAddress(id: number): Promise<void> {
  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('Removing a Bitcoin address requires a signed-in session.');
  }

  const { error } = await client.rpc('delete_wallet_address', { p_id: id });
  if (error) {
    throw new Error(`Removing the Bitcoin address failed: ${error.message}`);
  }
}

/**
 * List the resident's Bitcoin addresses with fresh balances.
 *
 * Returns an empty list (rather than throwing) when there is no session, so the
 * screen degrades to "none" instead of erroring. A per-address provider failure
 * becomes that record's `readError` and never fails the list.
 */
export async function listBitcoinAddresses(): Promise<
  readonly BitcoinAddressRecord[]
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

  const baseUrl = readBitcoinApiBase();
  return Promise.all(
    stored.map((row) => readAddressRecord(row.id, row.address, baseUrl)),
  );
}
