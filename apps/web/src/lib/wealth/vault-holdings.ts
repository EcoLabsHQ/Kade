import { createPublicClient, http, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import { METAMORPHO_VAULT_ABI } from '@/lib/invest/morpho-abi';
import {
  isMainnetRailConfigured,
  readMorphoVaultConfig,
  type MorphoVaultConfig,
} from '@/lib/invest/morpho-config';
import {
  EVM_READ_CHAINS,
  USDC_DECIMALS,
  formatUnits,
  readEvmBalances,
} from './evm';
import type { EvmChainBalance } from './types';

/**
 * The resident Safe's qualified holdings, read **from the chain**.
 *
 * The "Qualified vaults · Safe 0x…" section shows what the Safe actually holds
 * right now, per chain. Nothing is persisted for a vault position — the Invest
 * Morpho deposit and the Holdings "Move to vault" transfer write no row — so the
 * only truthful source is a fresh on-chain read pointed at the Safe address:
 *
 *   1. the Safe's native coin and USDC on every chain the app already reads,
 *      through the same `readEvmBalances` reader Holdings uses for linked
 *      wallets (here pointed at the Safe, not a wallet); and
 *   2. the Safe's MetaMorpho position on the rail's chain: its vault-share
 *      `balanceOf`, converted with the vault's own `convertToAssets` to the
 *      underlying USDC, so the row is a real amount rather than a share count.
 *
 * Honesty rules (the same ones the rest of Holdings follows):
 *
 *   - a chain the read did not produce is shown as an explicit **unread** row
 *     carrying the real reason — never a fabricated `0` and never silently
 *     dropped;
 *   - a genuine zero (the read succeeded and the Safe holds nothing) produces no
 *     row, so the screen keeps its existing empty state;
 *   - the Morpho row is attempted only when the rail is configured; if the rail
 *     is absent, no row is invented and no address is guessed.
 *
 * Every read is injected (`readBalances`, `readMorpho`, `morphoConfig`), so the
 * module is pure and directly testable with no network, exactly like
 * `@/lib/wealth/holdings`.
 */

/** What a row represents, so the presentational screen can style it. */
export type VaultHoldingKind = 'native' | 'usdc' | 'morpho' | 'unread';

/** One real holding in the resident Safe, or one chain that could not be read. */
export interface VaultHoldingRow {
  readonly key: string;
  readonly kind: VaultHoldingKind;
  readonly chainId: number;
  /** The chain the position sits on, so it is never implied to be elsewhere. */
  readonly chainName: string;
  /** Glyph text, e.g. `ETH`, `USDC`, `MM`, or `—` for an unread chain. */
  readonly symbol: string;
  /** The instrument name, e.g. `Ether`, `USDC`, `MetaMorpho USDC vault`. */
  readonly name: string;
  /**
   * The formatted amount with its unit, e.g. `1.500000 ETH`, `2500.000000
   * USDC`, or `—` when the read failed. Mirrors the linked-wallets row shape.
   */
  readonly amount: string;
  readonly usd: number | null;
  /** Set when the row exists only because a read failed; otherwise null. */
  readonly readError: string | null;
}

/** The chain metadata the read targets; the app's own read list by default. */
export interface VaultReadChain {
  readonly chainId: number;
  readonly name: string;
  readonly symbol: string;
}

/** What the Morpho reader is handed: the Safe and the resolved rail. */
export interface MorphoPositionInput {
  readonly safeAddress: string;
  readonly config: MorphoVaultConfig;
}

/**
 * The Morpho position read. `read` carries the raw share balance and the
 * underlying USDC value the vault itself reports; `failed` carries the reason a
 * row must show instead of a fabricated amount.
 */
export type MorphoPositionRead =
  | {
      readonly status: 'read';
      readonly shares: bigint;
      readonly assetsUsdc: bigint;
    }
  | { readonly status: 'failed'; readonly reason: string };

/** Injectable seams, so tests never touch the network. */
export interface VaultHoldingsOptions {
  /** The chains to read. Defaults to the app's own `EVM_READ_CHAINS`. */
  readonly chains?: readonly VaultReadChain[];
  /** Defaults to the shared `readEvmBalances`, pointed at the Safe. */
  readonly readBalances?: (address: string) => Promise<readonly EvmChainBalance[]>;
  /** Defaults to the MetaMorpho RPC read. */
  readonly readMorpho?: (input: MorphoPositionInput) => Promise<MorphoPositionRead>;
  /**
   * The resolved rail config. `undefined` resolves it from the environment
   * (only when the rail is configured); `null` omits the Morpho row entirely.
   */
  readonly morphoConfig?: MorphoVaultConfig | null;
}

/** Ether is the one native name the reference uses; symbols pass through. */
const NATIVE_NAMES: Readonly<Record<string, string>> = { ETH: 'Ether' };

/** The vault's instrument label, from the ERC-4626 surface. */
const MORPHO_INSTRUMENT = 'MetaMorpho USDC vault';

/** A readable message from an unknown thrown value. */
function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** True only for a strictly positive formatted amount; a zero is "empty". */
function isPositive(amount: string): boolean {
  return Number(amount) > 0;
}

/** The display name for a chain id, from the read list; never fabricated. */
function chainNameOf(chains: readonly VaultReadChain[], chainId: number): string {
  return chains.find((chain) => chain.chainId === chainId)?.name ?? `Chain ${chainId}`;
}

/**
 * Read the Safe's MetaMorpho position from the rail's chain.
 *
 * The vault is an ERC-4626 contract: `balanceOf` is the Safe's share balance and
 * `convertToAssets` is the vault's own share→underlying conversion, so the figure
 * is the vault's valuation rather than a share count or a guessed ratio.
 */
async function readMorphoPositionFromRpc(
  input: MorphoPositionInput,
): Promise<MorphoPositionRead> {
  const rpcUrl = process.env.ETHEREUM_RPC_URL?.trim();
  if (!rpcUrl) {
    return {
      status: 'failed',
      reason:
        'The Ethereum RPC endpoint is not configured, so the vault position ' +
        'could not be read.',
    };
  }

  try {
    // The rail is mainnet-frozen (`morpho-config`), so the mainnet chain
    // definition is the correct one; no chain-specific value is guessed.
    const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
    const shares = await client.readContract({
      address: input.config.vault as Address,
      abi: METAMORPHO_VAULT_ABI,
      functionName: 'balanceOf',
      args: [input.safeAddress as Address],
    });
    const assetsUsdc = await client.readContract({
      address: input.config.vault as Address,
      abi: METAMORPHO_VAULT_ABI,
      functionName: 'convertToAssets',
      args: [shares],
    });
    return { status: 'read', shares, assetsUsdc };
  } catch (cause) {
    return {
      status: 'failed',
      reason: `The vault position could not be read: ${reasonOf(cause)}`,
    };
  }
}

/**
 * Load the Safe's on-chain qualified holdings.
 *
 * Returns the rows to render. An empty array means a successful read found
 * nothing (the Screen keeps its truthful empty state). A failed read produces a
 * row with `readError` and `amount: '—'`, never a zero. A null/blank Safe
 * address returns no rows: there is nowhere to read from.
 */
export async function loadVaultHoldings(
  safeAddress: string | null | undefined,
  options: VaultHoldingsOptions = {},
): Promise<readonly VaultHoldingRow[]> {
  const address = typeof safeAddress === 'string' ? safeAddress.trim() : '';
  if (address === '') return [];

  const chains = options.chains ?? EVM_READ_CHAINS;
  const readBalances =
    options.readBalances ?? ((value: string) => readEvmBalances(value));
  const readMorpho = options.readMorpho ?? readMorphoPositionFromRpc;
  // Omitted unless the rail is actually configured; nothing is guessed.
  const morphoConfig =
    options.morphoConfig !== undefined
      ? options.morphoConfig
      : isMainnetRailConfigured()
        ? readMorphoVaultConfig()
        : null;

  const rows: VaultHoldingRow[] = [];

  let balances: readonly EvmChainBalance[] = [];
  let balancesFailure: string | null = null;
  try {
    balances = await readBalances(address);
  } catch (cause) {
    balancesFailure = `The vault balances could not be read: ${reasonOf(cause)}`;
  }

  for (const chain of chains) {
    const read = balances.find((balance) => balance.chainId === chain.chainId);
    if (!read) {
      // The chain did not produce a read: show it as unread with the real
      // reason, so it is never hidden and never turned into a zero.
      rows.push({
        key: `${address}:${chain.chainId}:unread`,
        kind: 'unread',
        chainId: chain.chainId,
        chainName: chain.name,
        symbol: '—',
        name: chain.name,
        amount: '—',
        usd: null,
        readError:
          balancesFailure ?? `The vault balance on ${chain.name} could not be read.`,
      });
      continue;
    }

    if (isPositive(read.nativeAmount)) {
      rows.push({
        key: `${address}:${chain.chainId}:native`,
        kind: 'native',
        chainId: chain.chainId,
        chainName: chain.name,
        symbol: read.nativeSymbol,
        name: NATIVE_NAMES[read.nativeSymbol] ?? read.nativeSymbol,
        amount: `${read.nativeAmount} ${read.nativeSymbol}`,
        usd: read.nativeUsd,
        readError: null,
      });
    }

    if (read.usdc && isPositive(read.usdc.amount)) {
      rows.push({
        key: `${address}:${chain.chainId}:usdc`,
        kind: 'usdc',
        chainId: chain.chainId,
        chainName: chain.name,
        symbol: read.usdc.symbol,
        name: read.usdc.symbol,
        amount: `${read.usdc.amount} ${read.usdc.symbol}`,
        usd: read.usdc.usd,
        readError: null,
      });
    }
  }

  if (morphoConfig) {
    let position: MorphoPositionRead;
    try {
      position = await readMorpho({ safeAddress: address, config: morphoConfig });
    } catch (cause) {
      position = {
        status: 'failed',
        reason: `The vault position could not be read: ${reasonOf(cause)}`,
      };
    }

    if (position.status === 'failed') {
      rows.push({
        key: `${address}:${morphoConfig.chainId}:morpho`,
        kind: 'morpho',
        chainId: morphoConfig.chainId,
        chainName: chainNameOf(chains, morphoConfig.chainId),
        symbol: 'MM',
        name: MORPHO_INSTRUMENT,
        amount: '—',
        usd: null,
        readError: position.reason,
      });
    } else if (position.shares > 0n) {
      const assets = formatUnits(position.assetsUsdc, USDC_DECIMALS);
      rows.push({
        key: `${address}:${morphoConfig.chainId}:morpho`,
        kind: 'morpho',
        chainId: morphoConfig.chainId,
        chainName: chainNameOf(chains, morphoConfig.chainId),
        symbol: 'MM',
        name: MORPHO_INSTRUMENT,
        // The vault's own share→underlying conversion: the amount is USDC.
        amount: `${assets} USDC`,
        usd: Number(assets),
        readError: null,
      });
    }
    // A read that found no shares is a genuine empty position: no row.
  }

  return rows;
}
