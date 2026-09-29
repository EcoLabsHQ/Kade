/**
 * Block-explorer links for transaction and address values.
 *
 * The explorer base comes from the frozen chain registry in `@kade/shared`, so a
 * link always points at the chain the value actually lives on rather than a
 * host hard-coded at the call site. An unknown chain id yields `null`, which the
 * caller renders as no link — a wrong explorer is worse than no link.
 */

import { chainByChainId } from '@kade/shared';

/** What a fragment of on-chain data is, for path construction. */
export type ExplorerKind = 'tx' | 'address';

/** The block-explorer base for a chain id, or null when the chain is unknown. */
export function explorerBase(chainId: number): string | null {
  return chainByChainId(chainId)?.explorerUrl ?? null;
}

/** A block-explorer URL for a transaction or address, or null when unknown. */
export function explorerLink(
  chainId: number,
  kind: ExplorerKind,
  value: string,
): string | null {
  const base = explorerBase(chainId);
  return base === null ? null : `${base}/${kind}/${value}`;
}

/** The explorer URL for a transaction hash on a chain, or null when unknown. */
export function transactionExplorerUrl(
  chainId: number,
  hash: string,
): string | null {
  return explorerLink(chainId, 'tx', hash);
}

/** The explorer URL for an address on a chain, or null when unknown. */
export function addressExplorerUrl(
  chainId: number,
  address: string,
): string | null {
  return explorerLink(chainId, 'address', address);
}
