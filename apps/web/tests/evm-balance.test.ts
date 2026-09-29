import { describe, expect, it, vi } from 'vitest';
import {
  EVM_READ_CHAINS,
  EvmReadError,
  formatNative,
  formatUnits,
  isEvmAddress,
  normalizeEvmAddress,
  readEvmBalances,
  type EvmReadChain,
} from '@/lib/wealth/evm';

/**
 * The EVM balance read is the only place that talks to the EVM provider.
 *
 * It is pure and injectable, so these tests pin the address handling, the
 * native + USDC parsing, the fixed-decimal formatting and the failure modes
 * without the network. A provider failure must not fabricate a zero balance: the
 * chain is skipped (or the token balance is reported as null), and an invalid
 * address must fail before any fetch is attempted.
 */

const CHECKSUMMED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const LOWERCASE = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
const BITCOIN_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const USDC_ONE = '0x1111111111111111111111111111111111111111';
const USDC_TWO = '0x2222222222222222222222222222222222222222';

const CHAIN_ONE: EvmReadChain = {
  chainId: 1,
  name: 'Ethereum',
  symbol: 'ETH',
  baseUrl: 'https://one.test',
  usdcAddress: USDC_ONE,
};
const CHAIN_TWO: EvmReadChain = {
  chainId: 8453,
  name: 'Base',
  symbol: 'ETH',
  baseUrl: 'https://two.test',
  usdcAddress: USDC_TWO,
};

interface FakeResponseInit {
  readonly ok?: boolean;
  readonly status?: number;
}

function jsonResponse(body: unknown, init: FakeResponseInit = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    async json() {
      return body;
    },
  } as unknown as Response;
}

function throwingJsonResponse(): Response {
  return {
    ok: true,
    status: 200,
    async json(): Promise<unknown> {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  } as unknown as Response;
}

/** Summary body: native wei + the native coin's USD price. */
function summary(coinBalance: string, exchangeRate: unknown): unknown {
  return { coin_balance: coinBalance, exchange_rate: exchangeRate };
}

/** Blockscout v1 token-balance body for USDC. */
function tokenBalance(raw: string): unknown {
  return { status: '1', message: 'OK', result: raw };
}

/** Blockscout v2 stats body: the one ETH/USD price applied to every chain. */
function stats(coinPrice: unknown): unknown {
  return { coin_price: coinPrice };
}

/** Route a fake fetch by matching the URL, so call order does not matter. */
function routedFetch(
  routes: readonly (readonly [string, unknown | (() => Response)])[],
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [needle, body] of routes) {
      if (url.includes(needle)) {
        return typeof body === 'function' ? body() : jsonResponse(body);
      }
    }
    return jsonResponse({}, { ok: false, status: 404 });
  }) as unknown as typeof fetch;
}

describe('isEvmAddress', () => {
  it('accepts a checksummed and a lowercase address', () => {
    expect(isEvmAddress(CHECKSUMMED)).toBe(true);
    expect(isEvmAddress(LOWERCASE)).toBe(true);
  });

  it('rejects garbage, a Bitcoin address, 0x-short and empty', () => {
    expect(isEvmAddress('garbage')).toBe(false);
    expect(isEvmAddress(BITCOIN_ADDRESS)).toBe(false);
    expect(isEvmAddress('0x1234')).toBe(false);
    expect(isEvmAddress('')).toBe(false);
    expect(isEvmAddress('   ')).toBe(false);
  });
});

describe('normalizeEvmAddress', () => {
  it('returns the EIP-55 checksum for either input case', () => {
    expect(normalizeEvmAddress(`  ${LOWERCASE}  `)).toBe(CHECKSUMMED);
    expect(normalizeEvmAddress(CHECKSUMMED)).toBe(CHECKSUMMED);
  });

  it('throws a typed error on an invalid address', () => {
    expect(() => normalizeEvmAddress('0x1234')).toThrow(EvmReadError);
  });
});

describe('formatUnits / formatNative', () => {
  it('formats wei as a fixed 18-decimal native string', () => {
    expect(formatNative(512_300_000_000_000_000n)).toBe('0.512300000000000000');
    expect(formatNative(1_000_000_000_000_000_000n)).toBe('1.000000000000000000');
    expect(formatNative(1n)).toBe('0.000000000000000001');
    expect(formatNative(0n)).toBe('0.000000000000000000');
  });

  it('formats a 6-decimal token amount as USDC is quoted', () => {
    expect(formatUnits(183_500_000n, 6)).toBe('183.500000');
    expect(formatUnits(1n, 6)).toBe('0.000001');
  });
});

/** Circle's canonical, native Arbitrum One USDC (verified on-chain). */
const ARBITRUM_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
/** The bridged USDC.e, which is deliberately never read. */
const ARBITRUM_BRIDGED_USDC_E = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8';

describe('EVM_READ_CHAINS', () => {
  it('targets Ethereum, Base and Arbitrum One mainnets, symbol ETH, with a USDC contract', () => {
    expect(EVM_READ_CHAINS.map((chain) => chain.chainId)).toEqual([
      1, 8453, 42161,
    ]);
    expect(EVM_READ_CHAINS.map((chain) => chain.name)).toEqual([
      'Ethereum',
      'Base',
      'Arbitrum One',
    ]);
    expect(EVM_READ_CHAINS.every((chain) => chain.symbol === 'ETH')).toBe(true);
    expect(EVM_READ_CHAINS.every((chain) => /^0x[0-9a-fA-F]{40}$/.test(chain.usdcAddress))).toBe(
      true,
    );
  });

  it('reads Arbitrum One from Circle-native USDC, never the bridged USDC.e', () => {
    const arbitrum = EVM_READ_CHAINS.find((chain) => chain.chainId === 42161)!;
    expect(arbitrum.name).toBe('Arbitrum One');
    expect(arbitrum.usdcAddress).toBe(ARBITRUM_USDC);
    expect(arbitrum.usdcAddress.toLowerCase()).not.toBe(
      ARBITRUM_BRIDGED_USDC_E.toLowerCase(),
    );
  });
});

describe('readEvmBalances', () => {
  it('reads the native coin and USDC, and sums them into usd', async () => {
    // The price comes from the one stats read, not the summary's
    // `exchange_rate`: the summary carries a deliberately wrong rate to prove
    // which source is actually used for the USD figure.
    const fetchImpl = routedFetch([
      ['/api/v2/stats', stats('2764.7')],
      ['/api/v2/addresses/', summary('512300000000000000', '1')],
      ['action=tokenbalance', tokenBalance('183500000')],
    ]);

    const balances = await readEvmBalances(CHECKSUMMED, {
      chains: [CHAIN_ONE],
      fetchImpl,
    });
    const balance = balances[0]!;

    expect(balance.chainId).toBe(1);
    expect(balance.name).toBe('Ethereum');
    expect(balance.nativeSymbol).toBe('ETH');
    expect(balance.nativeAmount).toBe('0.512300000000000000');
    expect(balance.nativeUsd).toBeCloseTo(0.5123 * 2764.7);
    expect(balance.usdc).toEqual({
      symbol: 'USDC',
      amount: '183.500000',
      usd: 183.5,
    });
    expect(balance.usd).toBeCloseTo(0.5123 * 2764.7 + 183.5);

    // The USDC read is scoped to this chain's known contract and the address.
    expect(fetchImpl).toHaveBeenCalledWith(
      `${CHAIN_ONE.baseUrl}/api?module=account&action=tokenbalance&contractaddress=${USDC_ONE}&address=${CHECKSUMMED}&tag=latest`,
    );
  });

  it('uses each chain baseUrl and its own USDC contract', async () => {
    const fetchImpl = routedFetch([
      ['/api/v2/stats', stats('1')],
      [`${CHAIN_ONE.baseUrl}/api/v2`, summary('1000000000000000000', '1')],
      [`${CHAIN_ONE.baseUrl}/api?`, tokenBalance('5000000')],
      [`${CHAIN_TWO.baseUrl}/api/v2`, summary('2000000000000000000', '1')],
      [`${CHAIN_TWO.baseUrl}/api?`, tokenBalance('7000000')],
    ]);

    const balances = await readEvmBalances(LOWERCASE, {
      chains: [CHAIN_ONE, CHAIN_TWO],
      fetchImpl,
    });

    expect(balances.map((balance) => balance.chainId)).toEqual([1, 8453]);
    expect(balances[0]!.usdc?.amount).toBe('5.000000');
    expect(balances[1]!.usdc?.amount).toBe('7.000000');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining(`contractaddress=${USDC_TWO}`),
    );
  });

  it('leaves nativeUsd null when the price is unavailable but still values the USDC', async () => {
    // A missing price must never fail the balance read: the native amount is
    // still returned and only the USD figure is left blank.
    const fetchImpl = routedFetch([
      ['/api/v2/stats', stats(null)],
      ['/api/v2/addresses/', summary('1000000000000000000', '9999')],
      ['action=tokenbalance', tokenBalance('2500000')],
    ]);

    const balances = await readEvmBalances(CHECKSUMMED, {
      chains: [CHAIN_ONE],
      fetchImpl,
    });
    const balance = balances[0]!;

    expect(balance.nativeAmount).toBe('1.000000000000000000');
    expect(balance.nativeUsd).toBeNull();
    expect(balance.usdc?.usd).toBe(2.5);
    // Native could not be valued, but the USDC could, so the chain still has a
    // USD figure rather than being discarded.
    expect(balance.usd).toBe(2.5);
  });

  it('keeps the chain and reports usdc null when the USDC read fails', async () => {
    const fetchImpl = routedFetch([
      ['/api/v2/stats', stats('2')],
      ['/api/v2/addresses/', summary('1000000000000000000', '2')],
      [
        'action=tokenbalance',
        () => jsonResponse({}, { ok: false, status: 500 }),
      ],
    ]);

    const balances = await readEvmBalances(CHECKSUMMED, {
      chains: [CHAIN_ONE],
      fetchImpl,
    });
    const balance = balances[0]!;

    expect(balance.nativeUsd).toBe(2);
    expect(balance.usdc).toBeNull();
    // The token sub-read's failure is carried with the chain, with its specific
    // reason, instead of being dropped: the amount is unread, not zero.
    expect(balance.tokenFailure).toMatchObject({
      chainId: 1,
      chainName: 'Ethereum',
      reason: 'unexpected',
    });
    expect(balance.tokenFailure?.message).toContain('500');
    // No fabricated zero anywhere: the token stays null and the chain's USD is
    // the native value alone.
    expect(balance.usd).toBe(2);
  });

  it('does not invent a tokenFailure when the USDC read succeeds with zero', async () => {
    const fetchImpl = routedFetch([
      ['/api/v2/addresses/', summary('1000000000000000000', '2')],
      ['action=tokenbalance', tokenBalance('0')],
    ]);

    const balances = await readEvmBalances(CHECKSUMMED, {
      chains: [CHAIN_ONE],
      fetchImpl,
    });

    const balance = balances[0]!;
    // A successful zero read is a real zero balance, not a failure.
    expect(balance.usdc).toEqual({ symbol: 'USDC', amount: '0.000000', usd: 0 });
    expect(balance.tokenFailure).toBeUndefined();
  });

  it('does not fabricate a zero USDC when its body has no result', async () => {
    const fetchImpl = routedFetch([
      ['/api/v2/addresses/', summary('1000000000000000000', '1')],
      ['action=tokenbalance', { status: '1', message: 'OK' }],
    ]);

    const balances = await readEvmBalances(CHECKSUMMED, {
      chains: [CHAIN_ONE],
      fetchImpl,
    });

    expect(balances[0]!.usdc).toBeNull();
  });

  it('skips a non-2xx chain without failing the whole read', async () => {
    const fetchImpl = routedFetch([
      [`${CHAIN_ONE.baseUrl}/api/v2`, summary('1000000000000000000', '1')],
      [`${CHAIN_ONE.baseUrl}/api?`, tokenBalance('0')],
      [`${CHAIN_TWO.baseUrl}/api/v2`, () => jsonResponse({}, { ok: false, status: 500 })],
    ]);

    const balances = await readEvmBalances(CHECKSUMMED, {
      chains: [CHAIN_ONE, CHAIN_TWO],
      fetchImpl,
    });

    expect(balances).toHaveLength(1);
    expect(balances[0]!.chainId).toBe(1);
  });

  it('skips a chain with malformed JSON without throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(throwingJsonResponse());

    const balances = await readEvmBalances(CHECKSUMMED, {
      chains: [CHAIN_ONE],
      fetchImpl,
    });

    expect(balances).toEqual([]);
  });

  it('skips a chain whose body has no coin_balance', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));

    const balances = await readEvmBalances(CHECKSUMMED, {
      chains: [CHAIN_ONE],
      fetchImpl,
    });

    expect(balances).toEqual([]);
  });

  it('throws a typed error before any fetch on an invalid address', async () => {
    const fetchImpl = vi.fn();

    await expect(
      readEvmBalances('0xdeadbeef', { chains: [CHAIN_ONE], fetchImpl }),
    ).rejects.toBeInstanceOf(EvmReadError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
