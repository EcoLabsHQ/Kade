import { createPublicClient, http, type Hex } from 'viem';
import type { ReceiptReader } from './service-fee';

/**
 * A viem-backed receipt reader for the residency service fee.
 *
 * Server-only in practice: the RPC URL can carry a provider key, so this is
 * reached from a server action and never bundled into the browser. A read
 * failure maps to "no receipt yet", so a transient endpoint error surfaces as
 * `pending` rather than as a paid or failed payment (same mapping as the
 * pre-approval rail's reader).
 */
export function createReceiptReader(rpcUrl: string): ReceiptReader {
  const client = createPublicClient({ transport: http(rpcUrl) });

  return {
    async getTransactionReceipt(hash: Hex) {
      try {
        const receipt = await client.getTransactionReceipt({ hash });
        if (!receipt) return null;
        return {
          status: receipt.status,
          blockNumber: receipt.blockNumber,
          logs: receipt.logs.map((log) => ({
            address: log.address,
            topics: log.topics,
            data: log.data,
          })),
        };
      } catch {
        // viem throws when the transaction is not yet mined. Treat any read
        // failure as "no receipt" so the caller reports `pending`.
        return null;
      }
    },

    getBlockNumber() {
      return client.getBlockNumber();
    },
  };
}
