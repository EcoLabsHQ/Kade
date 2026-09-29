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

/**
 * Why a chain's balance could not be read, as a stable machine-readable code.
 *
 * `no-endpoint` never reaches the network: the chain has no RPC/explorer base.
 * The other three are produced from the provider's response or the transport.
 *
 * Defined here, with `EvmChainBalance`, so the failure carrier travels with the
 * read it explains (`evm.ts` re-exports these for its existing callers).
 */
export type EvmReadFailureReason =
  | 'no-endpoint'
  | 'rejected'
  | 'timeout'
  | 'unexpected';

/** A final, explained failure to read one chain's balance. */
export interface EvmReadFailure {
  readonly chainId: number;
  readonly chainName: string;
  readonly reason: EvmReadFailureReason;
  /** Human-readable, specific and safe to show to the resident. */
  readonly message: string;
}

/**
 * A native-coin balance read on one EVM chain for a pasted address.
 *
 * `amount` is the formatted native amount (18 decimals, fixed), so it is
 * displayed without floating-point rounding drifting the figure.
 */
/** A token balance read for one address on one chain. */
export interface EvmTokenBalance {
  readonly symbol: string; // 'USDC'
  readonly amount: string; // formatted with the token's decimals, e.g. '150000.000000'
  readonly usd: number | null;
}

/** The native coin and USDC balances of one address on one chain. */
export interface EvmChainBalance {
  readonly chainId: number;
  readonly name: string; // 'Ethereum' | 'Base'
  readonly nativeSymbol: string; // 'ETH'
  readonly nativeAmount: string; // formatted native amount, 18 decimals, e.g. '0.512300'
  readonly nativeUsd: number | null;
  /** Null when the USDC read failed for this chain, so nothing is fabricated. */
  readonly usdc: EvmTokenBalance | null;
  /**
   * The specific reason the USDC sub-read failed, when the chain's native read
   * succeeded but its token read did not. `usdc` stays null and no zero is
   * fabricated: the reason travels with the chain so every consumer can say
   * *why* the token amount is unread instead of silently omitting the row.
   * Absent when the token read succeeded.
   */
  readonly tokenFailure?: EvmReadFailure;
  /** Native + USDC in USD, or null when neither could be valued. */
  readonly usd: number | null;
}

/** A pasted EVM address together with its freshest per-chain balances. */
export interface EvmAddressRecord {
  readonly address: string;
  readonly chains: readonly EvmChainBalance[];
  readonly usd: number | null;
  readonly readAt: string | null;
  readonly readError: string | null;
}

/** [arbitrary] encoding of the provider in public.wallets.provider. */
export const EVM_PROVIDER = 'pasted-address';

/**
 * [arbitrary] encoding of the provider in public.wallets.provider for a wallet
 * the resident connected through the browser extension or WalletConnect.
 *
 * Week-2 contract v1.2: a connected wallet is persisted (so it survives a
 * reload) but is never signature-verified — `verified_at` stays NULL. It is
 * therefore shown in Holdings as an unverified connected wallet, in its own
 * labelled section, and is **excluded from the Holdings total**. Pasting an
 * address continues to write `pasted-address` and is excluded by construction.
 */
export const CONNECTED_WALLET_PROVIDER = 'connected-wallet';

/** Maximum watch-only EVM addresses a resident may store. */
export const MAX_WALLET_ADDRESSES = 5;
