import { describe, expect, it } from 'vitest';
import type { Address, Hex } from 'viem';
import {
  ERC20_TRANSFER_TOPIC,
  verifyUsdcPayment,
  type ReceiptLog,
  type FeeReceiptReader,
  type TransactionReceiptView,
} from '@/lib/payments/preapproval-fee';

/**
 * The settlement-chain receipt check for the pre-approval fee.
 *
 * The rail only counts a successful receipt whose logs carry a USDC transfer to
 * the treasury of at least the fee. Everything else — a pending transaction, a
 * revert, the wrong token, the wrong recipient, an underpayment — must not be
 * reported as paid.
 */

const TOKEN = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address;
const OTHER_TOKEN = '0x9999999999999999999999999999999999999999' as Address;
const TREASURY = '0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A' as Address;
const OTHER_RECIPIENT = '0x2222222222222222222222222222222222222222' as Address;
const SENDER = '0x1111111111111111111111111111111111111111' as Address;
const TX = `0x${'cd'.repeat(32)}` as Hex;
const FEE_UNITS = 1_750_000n; // 1.75 USDC at six decimals

function topicFor(address: string): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as Hex;
}

function transferLog(
  token: Address,
  from: Address,
  to: Address,
  value: bigint,
): ReceiptLog {
  return {
    address: token,
    topics: [ERC20_TRANSFER_TOPIC, topicFor(from), topicFor(to)],
    data: `0x${value.toString(16).padStart(64, '0')}` as Hex,
  };
}

function readerFor(
  receipt: TransactionReceiptView | null,
  blockNumber = 100n,
): FeeReceiptReader {
  return {
    getTransactionReceipt: async () => receipt,
    getBlockNumber: async () => blockNumber,
  };
}

function verify(
  receipt: TransactionReceiptView | null,
  { minimumUnits = FEE_UNITS, blockNumber = 100n } = {},
) {
  return verifyUsdcPayment({
    reader: readerFor(receipt, blockNumber),
    txHash: TX,
    token: TOKEN,
    to: TREASURY,
    minimumUnits,
  });
}

describe('verifyUsdcPayment', () => {
  it('accepts a successful USDC transfer to the treasury of at least the fee', async () => {
    const result = await verify({
      status: 'success',
      blockNumber: 100n,
      logs: [transferLog(TOKEN, SENDER, TREASURY, FEE_UNITS)],
    });

    expect(result.status).toBe('paid');
    if (result.status === 'paid') {
      expect(result.amountUnits).toBe(FEE_UNITS);
      expect(result.from.toLowerCase()).toBe(SENDER.toLowerCase());
    }
  });

  it('reports pending while the transaction is not mined', async () => {
    expect((await verify(null)).status).toBe('pending');
  });

  it('reports pending until one confirmation is included', async () => {
    // The receipt is at block 100, but the tip is only at 99.
    const result = await verify(
      { status: 'success', blockNumber: 100n, logs: [transferLog(TOKEN, SENDER, TREASURY, FEE_UNITS)] },
      { blockNumber: 99n },
    );
    expect(result.status).toBe('pending');
  });

  it('reports a reverted transaction as failed, never paid', async () => {
    const result = await verify({
      status: 'reverted',
      blockNumber: 100n,
      logs: [transferLog(TOKEN, SENDER, TREASURY, FEE_UNITS)],
    });
    expect(result.status).toBe('failed');
  });

  it('does not count a transfer of another token', async () => {
    const result = await verify({
      status: 'success',
      blockNumber: 100n,
      logs: [transferLog(OTHER_TOKEN, SENDER, TREASURY, FEE_UNITS)],
    });
    expect(result.status).toBe('no-transfer');
  });

  it('does not count a transfer to another recipient', async () => {
    const result = await verify({
      status: 'success',
      blockNumber: 100n,
      logs: [transferLog(TOKEN, SENDER, OTHER_RECIPIENT, FEE_UNITS)],
    });
    expect(result.status).toBe('no-transfer');
  });

  it('reports an underpayment with the amount it saw', async () => {
    const result = await verify({
      status: 'success',
      blockNumber: 100n,
      logs: [transferLog(TOKEN, SENDER, TREASURY, FEE_UNITS - 1n)],
    });
    expect(result.status).toBe('underpaid');
    if (result.status === 'underpaid') {
      expect(result.receivedUnits).toBe(FEE_UNITS - 1n);
    }
  });

  it('ignores logs that are not ERC-20 transfers', async () => {
    const result = await verify({
      status: 'success',
      blockNumber: 100n,
      logs: [
        {
          address: TOKEN,
          topics: [`0x${'ff'.repeat(32)}` as Hex],
          data: '0x' as Hex,
        },
      ],
    });
    expect(result.status).toBe('no-transfer');
  });

  it('counts the largest matching transfer when several are present', async () => {
    const result = await verify({
      status: 'success',
      blockNumber: 100n,
      logs: [
        transferLog(TOKEN, SENDER, TREASURY, 1n),
        transferLog(TOKEN, SENDER, TREASURY, FEE_UNITS),
      ],
    });
    expect(result.status).toBe('paid');
  });
});
