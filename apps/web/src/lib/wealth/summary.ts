/**
 * The proof-of-wealth total and its source counts.
 *
 * Three paths report wealth: a connected wallet (read-only), a pasted EVM
 * address (read-only), and a Bitcoin address (read-only). A resident can arrive
 * at the same EVM address twice — connected through AppKit and pasted by hand,
 * or connected through two methods at once. The address is one wallet, so its
 * balance must be counted once and its source must appear once.
 *
 * Deduplication is by address and is EVM-only: Bitcoin lives in a different
 * address space, so a Bitcoin address is never collapsed into an EVM one. The
 * first occurrence wins, so a connected entry takes precedence over a pasted
 * one with the same address.
 */

import type {
  BitcoinAddressRecord,
  EvmAddressRecord,
  EvmChainBalance,
} from '@/lib/wealth/types';

/**
 * The connected-wallet shape the total needs.
 *
 * The per-chain balances and the record's `readError` travel with the summary so
 * a connected wallet that read natively but failed its USDC sub-read — or whose
 * chain read failed entirely — is not reduced to its address and a USD figure
 * here. The summary is the connected-wallet list of Step 3, so the failure must
 * survive to it; dropping it is what made the reason invisible.
 */
export interface ConnectedWalletSummary {
  readonly address: string;
  readonly usd: number | null;
  /** Per-chain balances, carrying each chain's `tokenFailure` when unread. */
  readonly chains?: readonly EvmChainBalance[];
  /** The specific reason(s) the balance read failed, when it did. */
  readonly readError?: string | null;
}

export interface WealthSummary {
  /** Native USD total, counting each distinct address once. */
  readonly total: number;
  /** Distinct connected-wallet addresses. */
  readonly connectedCount: number;
  /** Distinct pasted EVM addresses that are not already connected. */
  readonly walletAddressCount: number;
  /** Bitcoin addresses, which are never collapsed into EVM addresses. */
  readonly bitcoinCount: number;
}

function normalized(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Aggregate the three sources, counting each distinct EVM address once.
 *
 * A connected address shadows a pasted address with the same value, so the
 * displayed total and the per-source counts describe the same set of wallets.
 */
export function summarizeWealth(input: {
  readonly connectedWallets: readonly ConnectedWalletSummary[];
  readonly evmAddresses: readonly EvmAddressRecord[];
  readonly bitcoinAddresses: readonly BitcoinAddressRecord[];
}): WealthSummary {
  const connectedAddresses = new Set<string>();
  let total = 0;
  for (const wallet of input.connectedWallets) {
    const key = normalized(wallet.address);
    if (connectedAddresses.has(key)) continue;
    connectedAddresses.add(key);
    total += wallet.usd ?? 0;
  }

  const pastedAddresses = new Set<string>();
  for (const record of input.evmAddresses) {
    const key = normalized(record.address);
    if (connectedAddresses.has(key) || pastedAddresses.has(key)) continue;
    pastedAddresses.add(key);
    total += record.usd ?? 0;
  }

  for (const record of input.bitcoinAddresses) {
    total += record.usd ?? 0;
  }

  return {
    total,
    connectedCount: connectedAddresses.size,
    walletAddressCount: pastedAddresses.size,
    bitcoinCount: input.bitcoinAddresses.length,
  };
}
