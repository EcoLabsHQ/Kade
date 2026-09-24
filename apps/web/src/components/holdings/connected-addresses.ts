import type { useConnections } from 'wagmi';

/**
 * The connected-address helpers shared by the Holdings wallet actions.
 *
 * A "connection" is one live wagmi connector; its `accounts` are the addresses
 * it currently reports. The distinct addresses across every connection are what
 * the per-row actions compare a stored address against, case-insensitively.
 */

/** One live wagmi connection, as `useConnections` reports it. */
export type WalletConnection = ReturnType<typeof useConnections>[number];
/** The account type wagmi reports for a connection (a checksummed address). */
export type WalletAddress = WalletConnection['accounts'][number];

/**
 * The distinct addresses across every live connection, in connection order. The
 * first occurrence of an address wins, and addresses that differ only by case
 * are one wallet, so a duplicated connection is not offered twice.
 */
export function liveAddresses(
  connections: readonly WalletConnection[],
): WalletAddress[] {
  const seen = new Set<string>();
  const addresses: WalletAddress[] = [];
  for (const connection of connections) {
    for (const account of connection.accounts) {
      const key = account.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      addresses.push(account);
    }
  }
  return addresses;
}

/**
 * The live connection that reports `address`, matched case-insensitively, or
 * null when no connected wallet controls it.
 */
export function connectionForAddress(
  connections: readonly WalletConnection[],
  address: string,
): WalletConnection | null {
  const key = address.trim().toLowerCase();
  for (const connection of connections) {
    if (connection.accounts.some((account) => account.trim().toLowerCase() === key)) {
      return connection;
    }
  }
  return null;
}
