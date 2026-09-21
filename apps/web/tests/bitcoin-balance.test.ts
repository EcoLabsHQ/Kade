import { describe, expect, it, vi } from 'vitest';
import {
  BitcoinReadError,
  formatBitcoin,
  isBitcoinAddress,
  normalizeBitcoinAddress,
  readBitcoinBalance,
} from '@/lib/wealth/bitcoin';

/**
 * The balance read is the only place that talks to the Bitcoin provider.
 *
 * It is pure and injectable, so these tests pin the parsing, the satoshi math
 * and the failure modes without the network. A price failure must not fail the
 * balance read, and a provider failure must be a typed error rather than a
 * silently fabricated zero.
 */

const MAINNET_BECH32 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TESTNET_BECH32 = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const MAINNET_P2PKH = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const MAINNET_P2SH = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
const EVM_ADDRESS = '0x71C9dE5d3e6f3c3b9f0e5A1c2D4b6E8f0A1B2C3D';
const BASE = 'https://example.test';

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

function balanceBody(funded: number, spent: number): unknown {
  return { chain_stats: { funded_txo_sum: funded, spent_txo_sum: spent } };
}

describe('isBitcoinAddress', () => {
  it('accepts valid mainnet and testnet addresses', () => {
    expect(isBitcoinAddress(MAINNET_BECH32)).toBe(true);
    expect(isBitcoinAddress(TESTNET_BECH32)).toBe(true);
    expect(isBitcoinAddress(MAINNET_P2PKH)).toBe(true);
    expect(isBitcoinAddress(MAINNET_P2SH)).toBe(true);
  });

  it('rejects garbage, an EVM address and an empty string', () => {
    expect(isBitcoinAddress('garbage')).toBe(false);
    expect(isBitcoinAddress('not-an-address')).toBe(false);
    expect(isBitcoinAddress(EVM_ADDRESS)).toBe(false);
    expect(isBitcoinAddress('')).toBe(false);
    expect(isBitcoinAddress('   ')).toBe(false);
  });
});

describe('normalizeBitcoinAddress', () => {
  it('trims and lower-cases bech32, so one address cannot occupy two slots', () => {
    expect(normalizeBitcoinAddress(`  ${MAINNET_BECH32.toUpperCase()}  `)).toBe(
      MAINNET_BECH32,
    );
    expect(normalizeBitcoinAddress(TESTNET_BECH32.toUpperCase())).toBe(
      TESTNET_BECH32,
    );
  });

  it('never lower-cases base58, which is case-sensitive', () => {
    expect(normalizeBitcoinAddress(` ${MAINNET_P2PKH} `)).toBe(MAINNET_P2PKH);
    expect(normalizeBitcoinAddress(MAINNET_P2SH)).toBe(MAINNET_P2SH);
  });
});

describe('formatBitcoin', () => {
  it('formats satoshis as a fixed 8-decimal BTC string', () => {
    expect(formatBitcoin(100_000)).toBe('0.00100000');
    expect(formatBitcoin(100_000_000)).toBe('1.00000000');
    expect(formatBitcoin(1)).toBe('0.00000001');
    expect(formatBitcoin(0)).toBe('0.00000000');
  });
});

describe('readBitcoinBalance', () => {
  it('computes satoshis as funded minus spent and formats BTC', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(balanceBody(150_000, 50_000)))
      .mockResolvedValueOnce(jsonResponse({ USD: 60_000 }));

    const result = await readBitcoinBalance(MAINNET_BECH32, {
      baseUrl: BASE,
      fetchImpl,
    });

    expect(result.satoshis).toBe(100_000);
    expect(result.btc).toBe('0.00100000');
    expect(result.usd).toBeCloseTo(60);
    expect(result.address).toBe(MAINNET_BECH32);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `${BASE}/api/address/${MAINNET_BECH32}`,
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(2, `${BASE}/api/v1/prices`);
  });

  it('leaves usd null when the price read fails, without failing the balance', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(balanceBody(200_000, 0)))
      .mockResolvedValueOnce(jsonResponse({}, { ok: false, status: 500 }));

    const result = await readBitcoinBalance(TESTNET_BECH32, {
      baseUrl: BASE,
      fetchImpl,
    });

    expect(result.satoshis).toBe(200_000);
    expect(result.btc).toBe('0.00200000');
    expect(result.usd).toBeNull();
  });

  it('leaves usd null when the price body is malformed', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(balanceBody(100, 0)))
      .mockResolvedValueOnce(jsonResponse({ USD: 'not-a-number' }));

    const result = await readBitcoinBalance(MAINNET_BECH32, {
      baseUrl: BASE,
      fetchImpl,
    });

    expect(result.usd).toBeNull();
  });

  it('throws a typed error on a non-2xx response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({}, { ok: false, status: 404 }));

    await expect(
      readBitcoinBalance(MAINNET_BECH32, { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(BitcoinReadError);
  });

  it('throws on malformed JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(throwingJsonResponse());

    await expect(
      readBitcoinBalance(MAINNET_BECH32, { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(BitcoinReadError);
  });

  it('throws on a body without chain_stats', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));

    await expect(
      readBitcoinBalance(MAINNET_BECH32, { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(BitcoinReadError);
  });

  it('refuses an invalid address before calling the provider', async () => {
    const fetchImpl = vi.fn();

    await expect(
      readBitcoinBalance(EVM_ADDRESS, { baseUrl: BASE, fetchImpl }),
    ).rejects.toBeInstanceOf(BitcoinReadError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
