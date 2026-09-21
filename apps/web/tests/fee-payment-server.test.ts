import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';

/**
 * The server half of the pre-approval fee payment.
 *
 * The Supabase client and the Sepolia reader are both faked, so the module's
 * own decisions are what is under test: the amount comes from the application
 * row, a recorded hash is replaced rather than trusted, and a receipt that does
 * not prove the payment is never reported as paid.
 */

const hoisted = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  receipt: vi.fn(),
  blockNumber: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: hoisted.from,
    rpc: hoisted.rpc,
  }),
}));

vi.mock('@/lib/payments/sepolia-reader', () => ({
  createSepoliaReader: () => ({
    getTransactionReceipt: hoisted.receipt,
    getBlockNumber: hoisted.blockNumber,
  }),
}));

vi.mock('@/lib/env', () => ({
  readTreasuryAddress: () => '0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A',
  readSepoliaRpcUrl: () => 'https://sepolia.example',
}));

import { recordFeePayment, loadFeePayment } from '@/lib/payments/server';
import { ERC20_TRANSFER_TOPIC } from '@/lib/payments/preapproval-fee';

const TOKEN = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address;
const TREASURY = '0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A' as Address;
const SENDER = '0x1111111111111111111111111111111111111111' as Address;
const TX = `0x${'cd'.repeat(32)}` as Hex;
const OTHER_TX = `0x${'ef'.repeat(32)}` as Hex;

function topicFor(address: string): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as Hex;
}

function paidReceipt(value = 1_750_000n) {
  return {
    status: 'success' as const,
    blockNumber: 10n,
    logs: [
      {
        address: TOKEN,
        topics: [ERC20_TRANSFER_TOPIC, topicFor(SENDER), topicFor(TREASURY)],
        data: `0x${value.toString(16).padStart(64, '0')}` as Hex,
      },
    ],
  };
}

/** A `from` chain that returns one application row. */
function applicationRow(feeTx: string | null, fee = '1.75') {
  hoisted.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { id: 'app-1', preapproval_usdc: fee, fee_tx: feeTx },
          error: null,
        }),
      }),
    }),
  });
}

beforeEach(() => {
  hoisted.rpc.mockResolvedValue({ data: null, error: null });
  hoisted.blockNumber.mockResolvedValue(10n);
  hoisted.receipt.mockResolvedValue(paidReceipt());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('recordFeePayment', () => {
  it('records a verified payment and returns paid', async () => {
    applicationRow(null);

    const result = await recordFeePayment('user-1', TX);

    expect(result).toEqual({ status: 'paid', txHash: TX });
    expect(hoisted.rpc).toHaveBeenCalledWith('record_preapproval_fee_tx', {
      p_tx_hash: TX,
    });
  });

  it('replaces an earlier claim when a real payment is submitted', async () => {
    // A fabricated hash was recorded first; the real payment must still land.
    applicationRow(OTHER_TX);

    const result = await recordFeePayment('user-1', TX);

    expect(result).toEqual({ status: 'paid', txHash: TX });
    expect(hoisted.rpc).toHaveBeenCalledWith('record_preapproval_fee_tx', {
      p_tx_hash: TX,
    });
  });

  it('does not record a hash whose receipt has no matching transfer', async () => {
    applicationRow(null);
    hoisted.receipt.mockResolvedValue({ status: 'success', blockNumber: 10n, logs: [] });

    const result = await recordFeePayment('user-1', TX);

    expect(result.status).toBe('no-transfer');
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it('does not record an underpayment', async () => {
    applicationRow(null);
    hoisted.receipt.mockResolvedValue(paidReceipt(1_000_000n));

    const result = await recordFeePayment('user-1', TX);

    expect(result.status).toBe('underpaid');
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it('reports a reverted transaction as failed and records nothing', async () => {
    applicationRow(null);
    hoisted.receipt.mockResolvedValue({ status: 'reverted', blockNumber: 10n, logs: [] });

    const result = await recordFeePayment('user-1', TX);

    expect(result.status).toBe('failed');
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed hash before touching the chain', async () => {
    applicationRow(null);

    const result = await recordFeePayment('user-1', 'not-a-hash');

    expect(result.status).toBe('invalid-hash');
    expect(hoisted.receipt).not.toHaveBeenCalled();
  });
});

describe('loadFeePayment', () => {
  it('reports paid only when the recorded hash still verifies', async () => {
    applicationRow(TX);

    expect(await loadFeePayment('user-1')).toEqual({ status: 'paid', txHash: TX });
  });

  it('reports unverified when the recorded hash does not verify', async () => {
    applicationRow(TX);
    hoisted.receipt.mockResolvedValue({ status: 'success', blockNumber: 10n, logs: [] });

    expect(await loadFeePayment('user-1')).toEqual({
      status: 'unverified',
      txHash: TX,
    });
  });

  it('reports none when nothing is recorded', async () => {
    applicationRow(null);

    expect(await loadFeePayment('user-1')).toEqual({ status: 'none' });
  });
});
