import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';

/**
 * The server half of the residency service fee (D16).
 *
 * The Supabase client and the receipt reader are faked, so the module's own
 * decisions are under test: the amount comes from `fee_schedule`, the transfer
 * must name the connected wallet as its sender, and a receipt that does not
 * prove the payment is never reported as paid. This mirrors the pre-approval
 * fee rail's tests.
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

vi.mock('@/lib/residency/receipt-reader', () => ({
  createReceiptReader: () => ({
    getTransactionReceipt: hoisted.receipt,
    getBlockNumber: hoisted.blockNumber,
  }),
}));

import {
  loadResidencyServiceFeePayment,
  readResidencyServiceFeeConfig,
  recordResidencyServiceFeePayment,
  resolveResidencyServiceFeeAmount,
} from '@/lib/residency/service-fee-server';
import { ERC20_TRANSFER_TOPIC } from '@/lib/payments/preapproval-fee';

const TOKEN = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address;
const MAINNET_TOKEN =
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
const TREASURY = '0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A' as Address;
const MAINNET_TREASURY =
  '0x4444444444444444444444444444444444444444' as Address;
const SENDER = '0x1111111111111111111111111111111111111111' as Address;
const OTHER_SENDER = '0x2222222222222222222222222222222222222222' as Address;
const TX = `0x${'cd'.repeat(32)}` as Hex;

function topicFor(address: string): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as Hex;
}

function paidReceipt(value = 10_000_000n, from: Address = SENDER) {
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

/** A client whose `applications` and `fee_schedule` rows are configurable. */
function database(
  serviceTx: string | null,
  serviceAmount: string | null = '10',
) {
  hoisted.from.mockImplementation((table: string) => {
    if (table === 'applications') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: 'app-1', service_tx: serviceTx },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'fee_schedule') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: serviceAmount === null ? null : { amount: serviceAmount },
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
}

beforeEach(() => {
  process.env.KADE_CHAIN_ENV = 'testnet';
  process.env.KADE_FEE_MODE = 'demo';
  process.env.TREASURY_ADDRESS = TREASURY;
  process.env.SEPOLIA_RPC_URL = 'https://sepolia.example';
  delete process.env.MAINNET_TREASURY_ADDRESS;
  delete process.env.ETHEREUM_RPC_URL;

  hoisted.rpc.mockResolvedValue({ data: null, error: null });
  hoisted.blockNumber.mockResolvedValue(10n);
  hoisted.receipt.mockResolvedValue(paidReceipt());
  database(null);
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.KADE_CHAIN_ENV;
  delete process.env.KADE_FEE_MODE;
  delete process.env.TREASURY_ADDRESS;
  delete process.env.SEPOLIA_RPC_URL;
  delete process.env.MAINNET_TREASURY_ADDRESS;
  delete process.env.ETHEREUM_RPC_URL;
});

describe('resolveResidencyServiceFeeAmount', () => {
  it('returns the configured service amount', async () => {
    expect(await resolveResidencyServiceFeeAmount('demo')).toBe(10);
  });

  it('returns null when the mode has no service row', async () => {
    database(null, null);
    expect(await resolveResidencyServiceFeeAmount('production')).toBeNull();
  });
});

describe('recordResidencyServiceFeePayment', () => {
  it('records a verified payment and returns paid', async () => {
    const result = await recordResidencyServiceFeePayment('user-1', TX, SENDER);

    expect(result).toEqual({ status: 'paid', txHash: TX });
    expect(hoisted.rpc).toHaveBeenCalledWith('record_residency_service_fee_tx', {
      p_tx_hash: TX,
    });
  });

  it('uses the fee_schedule amount as the minimum, not a client value', async () => {
    // The active schedule is 2,000 USDC while the receipt transfers 10 USDC.
    database(null, '2000');

    const result = await recordResidencyServiceFeePayment('user-1', TX, SENDER);

    expect(result.status).toBe('underpaid');
    if (result.status === 'underpaid') {
      expect(result.requiredUsdc).toBe('2000');
      expect(result.receivedUsdc).toBe('10');
    }
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it('does not record a hash whose receipt has no matching transfer', async () => {
    hoisted.receipt.mockResolvedValue({ status: 'success', blockNumber: 10n, logs: [] });

    const result = await recordResidencyServiceFeePayment('user-1', TX, SENDER);

    expect(result.status).toBe('no-transfer');
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it('reports a reverted transaction as failed and records nothing', async () => {
    hoisted.receipt.mockResolvedValue({ status: 'reverted', blockNumber: 10n, logs: [] });

    const result = await recordResidencyServiceFeePayment('user-1', TX, SENDER);

    expect(result.status).toBe('failed');
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed hash before touching the chain', async () => {
    const result = await recordResidencyServiceFeePayment('user-1', 'nope', SENDER);
    expect(result.status).toBe('invalid-hash');
    expect(hoisted.receipt).not.toHaveBeenCalled();
  });

  it('rejects a payment whose transfer came from another wallet', async () => {
    hoisted.receipt.mockResolvedValue(paidReceipt(10_000_000n, OTHER_SENDER));

    const result = await recordResidencyServiceFeePayment('user-1', TX, SENDER);

    expect(result).toEqual({ status: 'wrong-sender' });
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });
});

describe('loadResidencyServiceFeePayment', () => {
  it('reports paid only when the recorded hash still verifies', async () => {
    database(TX);
    expect(await loadResidencyServiceFeePayment('user-1')).toEqual({
      status: 'paid',
      txHash: TX,
    });
  });

  it('reports none when nothing is recorded', async () => {
    expect(await loadResidencyServiceFeePayment('user-1')).toEqual({ status: 'none' });
  });

  it('reports unverified when the recorded hash does not verify', async () => {
    database(TX);
    hoisted.receipt.mockResolvedValue({ status: 'success', blockNumber: 10n, logs: [] });

    expect(await loadResidencyServiceFeePayment('user-1')).toEqual({
      status: 'unverified',
      txHash: TX,
    });
  });
});

describe('readResidencyServiceFeeConfig — active settlement chain', () => {
  it('resolves Ethereum Sepolia and its USDC under testnet', () => {
    expect(readResidencyServiceFeeConfig()).toEqual({
      treasury: TREASURY,
      token: TOKEN,
      chainId: 11155111,
      rpcUrl: 'https://sepolia.example',
    });
  });

  it('resolves Ethereum mainnet, mainnet USDC and the mainnet treasury under mainnet', () => {
    process.env.KADE_CHAIN_ENV = 'mainnet';
    process.env.MAINNET_TREASURY_ADDRESS = MAINNET_TREASURY;
    process.env.ETHEREUM_RPC_URL = 'https://mainnet.example';

    expect(readResidencyServiceFeeConfig()).toEqual({
      treasury: MAINNET_TREASURY,
      token: MAINNET_TOKEN,
      chainId: 1,
      rpcUrl: 'https://mainnet.example',
    });
  });
});
