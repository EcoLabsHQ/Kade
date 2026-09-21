/**
 * Wealth-domain types shared by the Bitcoin watch-only path.
 *
 * A resident pastes an address; the server reads its balance from a public
 * Esplora-compatible provider and shows it. Only the address is persisted
 * (public.wallets, migration 20260921000001); the balance is read fresh every
 * time so the screen never shows a cached figure as if it were current.
 */

/** A stored Bitcoin address together with the freshest balance read. */
export interface BitcoinAddressRecord {
  readonly id: number;
  readonly address: string;
  readonly btc: string | null;
  readonly usd: number | null;
  readonly readAt: string | null;
  readonly readError: string | null;
}

/** A successful balance read for one address. */
export interface BitcoinBalanceRead {
  readonly address: string;
  readonly satoshis: number;
  readonly btc: string;
  readonly usd: number | null;
}

/** [arbitrary] sentinel: Bitcoin has no EVM chain id. */
export const BITCOIN_CHAIN_ID = 0;

/** [arbitrary] encoding of the provider in public.wallets.provider. */
export const BITCOIN_PROVIDER = 'bitcoin-address';

/** Maximum watch-only Bitcoin addresses a resident may store. */
export const MAX_BITCOIN_ADDRESSES = 5;
