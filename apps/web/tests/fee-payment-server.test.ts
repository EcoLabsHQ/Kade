import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';

/**
 * The server half of the pre-approval fee payment.
 *
 * The Supabase client and the Sepolia reader are both faked, so the module's
 * own decisions are what is under test: the amount comes from the application
 * row, a recorded hash is replaced rather than trusted, the transfer must name
 * the connected wallet as its sender, and a receipt that does not prove the
 * payment is never reported as paid.
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

vi.mock('@/lib/payments/fee-receipt-reader', () => ({
  createFeeReceiptReader: () => ({
    getTransactionReceipt: hoisted.receipt,
    getBlockNumber: hoisted.blockNumber,
  }),
}));

import {
  loadFeePayment,
  readFeePaymentConfig,
  recordFeePayment,
} from '@/lib/payments/server';
import { ERC20_TRANSFER_TOPIC } from '@/lib/payments/preapproval-fee';

const TOKEN = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address;
const MAINNET_USDC =
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
const TREASURY = '0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A' as Address;
const MAINNET_TREASURY =
  '0x3333333333333333333333333333333333333333' as Address;
const SENDER = '0x1111111111111111111111111111111111111111' as Address;
const OTHER_SENDER = '0x2222222222222222222222222222222222222222' as Address;
const TX = `0x${'cd'.repeat(32)}` as Hex;
const OTHER_TX = `0x${'ef'.repeat(32)}` as Hex;

function topicFor(address: string): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as Hex;
}

function paidReceipt(value = 1_750_000n, from: Address = SENDER) {
  return {
    status: 'success' as const,
    blockNumber: 10n,
    logs: [
      {
        address: TOKEN,
        topics: [ERC20_TRANSFER_TOPIC, topicFor(from), topicFor(TREASURY)],
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
  // The rail resolves its treasury, RPC and token from the active chain env, so
  // the test configures the process environment rather than mocking `@/lib/env`
  // and lets the real resolver run.
  process.env.KADE_CHAIN_ENV = 'testnet';
  process.env.TREASURY_ADDRESS = TREASURY;
  process.env.SEPOLIA_RPC_URL = 'https://sepolia.example';
  delete process.env.MAINNET_TREASURY_ADDRESS;
  delete process.env.ETHEREUM_RPC_URL;

  hoisted.rpc.mockResolvedValue({ data: null, error: null });
  hoisted.blockNumber.mockResolvedValue(10n);
  hoisted.receipt.mockResolvedValue(paidReceipt());
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.KADE_CHAIN_ENV;
  delete process.env.TREASURY_ADDRESS;
  delete process.env.SEPOLIA_RPC_URL;
  delete process.env.MAINNET_TREASURY_ADDRESS;
  delete process.env.ETHEREUM_RPC_URL;
});

describe('recordFeePayment', () => {
  it('records a verified payment and returns paid', async () => {
    applicationRow(null);

    const result = await recordFeePayment('user-1', TX, SENDER);

    expect(result).toEqual({ status: 'paid', txHash: TX });
    expect(hoisted.rpc).toHaveBeenCalledWith('record_preapproval_fee_tx', {
      p_tx_hash: TX,
    });
  });

  it('records an already-mined receipt that is deeply confirmed', async () => {
    applicationRow(null);
    // The receipt is far behind the chain tip, as it is once a payment has
    // settled; it must still resolve to paid rather than staying pending.
    hoisted.blockNumber.mockResolvedValue(1_000_000n);

    const result = await recordFeePayment('user-1', TX, SENDER);

    expect(result).toEqual({ status: 'paid', txHash: TX });
    expect(hoisted.rpc).toHaveBeenCalledWith('record_preapproval_fee_tx', {
      p_tx_hash: TX,
    });
  });

  it('replaces an earlier claim when a real payment is submitted', async () => {
    // A fabricated hash was recorded first; the real payment must still land.
    applicationRow(OTHER_TX);

    const result = await recordFeePayment('user-1', TX, SENDER);

    expect(result).toEqual({ status: 'paid', txHash: TX });
    expect(hoisted.rpc).toHaveBeenCalledWith('record_preapproval_fee_tx', {
      p_tx_hash: TX,
    });
  });

  it('does not record a hash whose receipt has no matching transfer', async () => {
    applicationRow(null);
    hoisted.receipt.mockResolvedValue({ status: 'success', blockNumber: 10n, logs: [] });

    const result = await recordFeePayment('user-1', TX, SENDER);

    expect(result.status).toBe('no-transfer');
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it('does not record an underpayment', async () => {
    applicationRow(null);
    hoisted.receipt.mockResolvedValue(paidReceipt(1_000_000n));

    const result = await recordFeePayment('user-1', TX, SENDER);

    expect(result.status).toBe('underpaid');
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it('reports a reverted transaction as failed and records nothing', async () => {
    applicationRow(null);
    hoisted.receipt.mockResolvedValue({ status: 'reverted', blockNumber: 10n, logs: [] });

    const result = await recordFeePayment('user-1', TX, SENDER);

    expect(result.status).toBe('failed');
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed hash before touching the chain', async () => {
    applicationRow(null);

    const result = await recordFeePayment('user-1', 'not-a-hash', SENDER);

    expect(result.status).toBe('invalid-hash');
    expect(hoisted.receipt).not.toHaveBeenCalled();
  });

  it('rejects a payment whose transfer came from another wallet', async () => {
    applicationRow(null);
    hoisted.receipt.mockResolvedValue(paidReceipt(1_750_000n, OTHER_SENDER));

    const result = await recordFeePayment('user-1', TX, SENDER);

    expect(result).toEqual({ status: 'wrong-sender' });
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it('accepts a payment whose transfer came from the connected wallet', async () => {
    applicationRow(null);
    hoisted.receipt.mockResolvedValue(paidReceipt(1_750_000n, SENDER));

    const result = await recordFeePayment('user-1', TX, SENDER);

    expect(result).toEqual({ status: 'paid', txHash: TX });
    expect(hoisted.rpc).toHaveBeenCalledWith('record_preapproval_fee_tx', {
      p_tx_hash: TX,
    });
  });

  it('matches the connected wallet without regard to address case', async () => {
    applicationRow(null);
    hoisted.receipt.mockResolvedValue(paidReceipt(1_750_000n, SENDER));

    const result = await recordFeePayment('user-1', TX, SENDER.toLowerCase());

    expect(result).toEqual({ status: 'paid', txHash: TX });
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

describe('readFeePaymentConfig — active settlement chain', () => {
  it('resolves Ethereum Sepolia and its USDC under testnet', () => {
    expect(readFeePaymentConfig()).toEqual({
      treasury: TREASURY,
      token: TOKEN,
      chainId: 11155111,
      chainName: 'Ethereum Sepolia',
      rpcUrl: 'https://sepolia.example',
    });
  });

  it('resolves Ethereum mainnet, mainnet USDC and the mainnet treasury under mainnet', () => {
    process.env.KADE_CHAIN_ENV = 'mainnet';
    process.env.MAINNET_TREASURY_ADDRESS = MAINNET_TREASURY;
    process.env.ETHEREUM_RPC_URL = 'https://mainnet.example';

    expect(readFeePaymentConfig()).toEqual({
      treasury: MAINNET_TREASURY,
      token: MAINNET_USDC,
      chainId: 1,
      chainName: 'Ethereum',
      rpcUrl: 'https://mainnet.example',
    });
  });

  it('is null when the active chain has no treasury or RPC', () => {
    delete process.env.TREASURY_ADDRESS;
    expect(readFeePaymentConfig()).toBeNull();
  });
});
