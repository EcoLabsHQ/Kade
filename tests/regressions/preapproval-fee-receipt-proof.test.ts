/**
 * Regression: the pre-approval fee must be proved from the Sepolia receipt.
 *
 * `applications.fee_tx` is a claim the caller can write (through
 * `record_preapproval_fee_tx`) and the browser supplies the hash. If "paid"
 * were ever derived from the hash being present, a fabricated hash would
 * present as a completed payment. This pins the invariant the rail depends on:
 * only a receipt that actually carries a USDC transfer to the treasury of at
 * least the fee counts.
 *
 * It failed before the receipt check existed (there was no such check); it must
 * keep passing.
 */

import { describe, expect, it } from 'vitest';
import type { Address, Hex } from 'viem';
import {
  ERC20_TRANSFER_TOPIC,
  verifyUsdcPayment,
} from '../../apps/web/src/lib/payments/preapproval-fee';

const TOKEN = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address;
const TREASURY = '0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A' as Address;
const SENDER = '0x1111111111111111111111111111111111111111' as Address;
const TX = `0x${'cd'.repeat(32)}` as Hex;
const FEE_UNITS = 1_750_000n;

function topicFor(address: string): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as Hex;
}

function transferLog(to: Address, value: bigint) {
  return {
    address: TOKEN,
    topics: [ERC20_TRANSFER_TOPIC, topicFor(SENDER), topicFor(to)],
    data: `0x${value.toString(16).padStart(64, '0')}` as Hex,
  };
}

async function verify(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
) {
  return verifyUsdcPayment({
    reader: {
      getTransactionReceipt: async () => ({
        status: 'success',
        blockNumber: 1n,
        logs,
      }),
      getBlockNumber: async () => 1n,
    },
    txHash: TX,
    token: TOKEN,
    to: TREASURY,
    minimumUnits: FEE_UNITS,
  });
}

describe('the pre-approval fee is proved from the receipt, not the hash', () => {
  it('does not report paid for a receipt with no matching transfer', async () => {
    expect((await verify([])).status).not.toBe('paid');
  });

  it('does not report paid for a transfer to a different recipient', async () => {
    const other = '0x2222222222222222222222222222222222222222' as Address;
    expect((await verify([transferLog(other, FEE_UNITS)])).status).not.toBe(
      'paid',
    );
  });

  it('does not report paid for a transfer below the fee', async () => {
    expect((await verify([transferLog(TREASURY, FEE_UNITS - 1n)])).status).not.toBe(
      'paid',
    );
  });
});
