import { describe, expect, it, vi } from 'vitest';
import {
  EVM_READ_CHAINS,
  EvmReadError,
  formatNative,
  isEvmAddress,
  normalizeEvmAddress,
  readEvmBalances,
  type EvmReadChain,
} from '@/lib/wealth/evm';

/**
 * The EVM balance read is the only place that talks to the EVM provider.
 *
 * It is pure and injectable, so these tests pin the address handling, the
 * wei -> fixed-decimal formatting and the failure modes without the network. A
 * provider failure must not fabricate a zero balance: the chain is skipped, and
 * an invalid address must fail before any fetch is attempted.
 */

const CHECKSUMMED = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const LOWERCASE = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
const BITCOIN_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

const CHAIN_ONE: EvmReadChain = {
  chainId: 1,
  name: 'Ethereum',
  symbol: 'ETH',
  baseUrl: 'https://one.test',
};
const CHAIN_TWO: EvmReadChain = {
  chainId: 8453,
  name: 'Base',
  symbol: 'ETH',
  baseUrl: 'https://two.test',
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

describe('formatNative', () => {
  it('formats wei as a fixed 18-decimal native string', () => {
    expect(formatNative(512_300_000_000_000_000n)).toBe('0.512300000000000000');
    expect(formatNative(1_000_000_000_000_000_000n)).toBe('1.000000000000000000');
    expect(formatNative(1n)).toBe('0.000000000000000001');
    expect(formatNative(0n)).toBe('0.000000000000000000');
  });
});

describe('EVM_READ_CHAINS', () => {
  it('targets the Ethereum and Base mainnets, symbol ETH', () => {
    expect(EVM_READ_CHAINS.map((chain) => chain.chainId)).toEqual([1, 8453]);
    expect(EVM_READ_CHAINS.map((chain) => chain.name)).toEqual([
      'Ethereum',
      'Base',
    ]);
    expect(EVM_READ_CHAINS.every((chain) => chain.symbol === 'ETH')).toBe(true);
  });
});

describe('readEvmBalances', () => {
  it('parses coin_balance and exchange_rate into amount and usd', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        coin_balance: '512300000000000000',
        exchange_rate: '2764.7',
      }),
    );

    const balances = await readEvmBalances(CHECKSUMMED, {
      chains: [CHAIN_ONE],
      fetchImpl,
    });
    const balance = balances[0]!;

    expect(balance.amount).toBe('0.512300000000000000');
    expect(balance.usd).toBeCloseTo(0.5123 * 2764.7);
    expect(balance.chainId).toBe(1);
    expect(balance.symbol).toBe('ETH');
    expect(fetchImpl).toHaveBeenCalledWith(
      `${CHAIN_ONE.baseUrl}/api/v2/addresses/${CHECKSUMMED}`,
    );
  });

  it('uses each chain baseUrl, in order', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ coin_balance: '1000000000000000000', exchange_rate: '1' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ coin_balance: '2000000000000000000', exchange_rate: '1' }),
      );

    const balances = await readEvmBalances(LOWERCASE, {
      chains: [CHAIN_ONE, CHAIN_TWO],
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `${CHAIN_ONE.baseUrl}/api/v2/addresses/${CHECKSUMMED}`,
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `${CHAIN_TWO.baseUrl}/api/v2/addresses/${CHECKSUMMED}`,
    );
    expect(balances.map((balance) => balance.chainId)).toEqual([1, 8453]);
  });

  it('leaves usd null on a null rate but still returns the amount', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ coin_balance: '1000000000000000000', exchange_rate: null }),
      );

    const balances = await readEvmBalances(CHECKSUMMED, {
      chains: [CHAIN_ONE],
      fetchImpl,
    });
    const balance = balances[0]!;

    expect(balance.amount).toBe('1.000000000000000000');
    expect(balance.usd).toBeNull();
  });

  it('leaves usd null on a non-numeric rate', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ coin_balance: '1000000000000000000', exchange_rate: 'n/a' }),
      );

    const balances = await readEvmBalances(CHECKSUMMED, {
      chains: [CHAIN_ONE],
      fetchImpl,
    });
    const balance = balances[0]!;

    expect(balance.amount).toBe('1.000000000000000000');
    expect(balance.usd).toBeNull();
  });

  it('skips a non-2xx chain without failing the whole read', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ coin_balance: '1000000000000000000', exchange_rate: '1' }),
      )
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));

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
