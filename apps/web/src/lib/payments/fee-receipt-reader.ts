import { createPublicClient, http, type Hex } from 'viem';
import type { FeeReceiptReader } from './preapproval-fee';

/**
 * The viem-backed `FeeReceiptReader` for the fee verification.
 *
 * Server-only in practice: the RPC URL carries a provider key
 * (`readRpcUrlFor`), so this is reached from a server action and never bundled
 * into the browser. A read failure is mapped to "not mined yet" so a transient
 * endpoint error surfaces as `pending` rather than as a paid or failed payment.
 */
export function createFeeReceiptReader(rpcUrl: string): FeeReceiptReader {
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
