import { CHAIN_IDS, MORPHO_VAULT_CHAIN_IDS, chainByChainId, rpcEnvVarForChain } from '@kade/shared';
import { createPublicClient, http, type Address, type Chain } from 'viem';
import { arbitrum, base, mainnet } from 'viem/chains';
import { METAMORPHO_VAULT_ABI } from '@/lib/invest/morpho-abi';
import {
  isMorphoRailConfiguredForChain,
  readMorphoVaultConfigForChain,
  type MorphoVaultConfig,
} from '@/lib/invest/morpho-config';
import {
  EVM_READ_CHAINS,
  EVM_READ_CONCURRENCY,
  USDC_DECIMALS,
  formatUnits,
  mapWithConcurrency,
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
 *   2. the Safe's MetaMorpho position on **each configured rail** (Ethereum
 *      mainnet, Base, Arbitrum One): its vault-share `balanceOf`, converted with
 *      the vault's own `convertToAssets` to the underlying USDC, so the row is a
 *      real amount rather than a share count. Each row carries its own chain, so
 *      a Base position is never implied to sit on Ethereum.
 *
 * Honesty rules (the same ones the rest of Holdings follows):
 *
 *   - a chain the read did not produce is shown as an explicit **unread** row
 *     carrying the real reason — never a fabricated `0` and never silently
 *     dropped;
 *   - a genuine zero (the read succeeded and the Safe holds nothing) produces no
 *     row, so the screen keeps its existing empty state;
 *   - a Morpho row is attempted only for a rail that is configured; if no rail
 *     is configured, no row is invented and no address is guessed.
 *
 * Every read is injected (`readBalances`, `readMorpho`, `morphoConfigs`), so the
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
   * The resolved rails to read, one per configured chain. `undefined` resolves
   * the app's configured rails (each chain in `MORPHO_VAULT_CHAIN_IDS` whose
   * vault **and** RPC are present); `null` or an empty array omits the Morpho
   * rows entirely.
   */
  readonly morphoConfigs?: readonly MorphoVaultConfig[] | null;
}

/** Ether is the one native name the reference uses; symbols pass through. */
const NATIVE_NAMES: Readonly<Record<string, string>> = { ETH: 'Ether' };

/** The vault's instrument label, from the ERC-4626 surface. */
const MORPHO_INSTRUMENT = 'MetaMorpho USDC vault';

/**
 * The viem chain definition for each vault chain, so a Base position is read
 * through Base's definition and an Arbitrum position through Arbitrum's. The
 * endpoint is the chain's own RPC variable, never the definition's public
 * default.
 */
const VIEM_CHAIN_BY_ID: Readonly<Record<number, Chain>> = {
  [CHAIN_IDS.ethereum]: mainnet,
  [CHAIN_IDS.base]: base,
  [CHAIN_IDS.arbitrum]: arbitrum,
};

/** A readable message from an unknown thrown value. */
function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** True only for a strictly positive formatted amount; a zero is "empty". */
function isPositive(amount: string): boolean {
  return Number(amount) > 0;
}

/** The display name for a chain id: the read list, then the shared registry. */
function chainNameOf(chains: readonly VaultReadChain[], chainId: number): string {
  return (
    chains.find((chain) => chain.chainId === chainId)?.name ??
    chainByChainId(chainId)?.name ??
    `Chain ${chainId}`
  );
}

/**
 * The rails the app may read a position from, one per configured chain.
 *
 * A chain is included only when its vault **and** its own RPC variable are both
 * present (`isMorphoRailConfiguredForChain`), so a chain the app cannot reach is
 * omitted rather than borrowing another chain's endpoint. When a rail is
 * supplied explicitly the caller owns this choice.
 */
function configuredMorphoConfigs(): readonly MorphoVaultConfig[] {
  const configs: MorphoVaultConfig[] = [];
  for (const chainId of MORPHO_VAULT_CHAIN_IDS) {
    if (!isMorphoRailConfiguredForChain(chainId)) continue;
    const config = readMorphoVaultConfigForChain(chainId);
    if (config) configs.push(config);
  }
  return configs;
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
  const { chainId } = input.config;
  const chainName = chainByChainId(chainId)?.name ?? `chain ${chainId}`;
  const variable = rpcEnvVarForChain(chainId);
  if (!variable) {
    return {
      status: 'failed',
      reason:
        `chain ${chainId} has no RPC variable, so the vault position could not ` +
        'be read.',
    };
  }
  const rpcUrl = process.env[variable]?.trim();
  if (!rpcUrl) {
    return {
      status: 'failed',
      reason:
        `The ${chainName} RPC endpoint is not configured (${variable}), so the ` +
        'vault position could not be read.',
    };
  }

  const chain = VIEM_CHAIN_BY_ID[chainId];
  if (!chain) {
    return {
      status: 'failed',
      reason:
        `chain ${chainId} is not a supported vault chain, so the vault position ` +
        'could not be read.',
    };
  }

  try {
    // The client is built for the rail's own chain and its own endpoint; no
    // chain-specific value is guessed and another chain's RPC is never used.
    const client = createPublicClient({ chain, transport: http(rpcUrl) });
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
  // One rail per configured chain, in registry order; omitted unless actually
  // configured (vault and RPC both present). Nothing is guessed.
  const morphoConfigs =
    options.morphoConfigs !== undefined
      ? options.morphoConfigs
      : configuredMorphoConfigs();

  const configs = morphoConfigs ?? [];
  const rows: VaultHoldingRow[] = [];

  // The balance read and the per-rail vault reads are independent, so they are
  // issued together: a navigation pays the slower of the two, not their sum.
  // The vault rails also run with a small concurrency bound rather than one
  // after another. Results keep the registry order, so the rendered rows are
  // unchanged. A balance failure is still carried to every chain row, and a
  // vault failure is still carried on its own row — nothing is fabricated.
  const [balanceResult, morphoPositions] = await Promise.all([
    (async (): Promise<{
      readonly balances: readonly EvmChainBalance[];
      readonly failure: string | null;
    }> => {
      try {
        return { balances: await readBalances(address), failure: null };
      } catch (cause) {
        return {
          balances: [],
          failure: `The vault balances could not be read: ${reasonOf(cause)}`,
        };
      }
    })(),
    mapWithConcurrency(
      configs,
      EVM_READ_CONCURRENCY,
      async (config): Promise<MorphoPositionRead> => {
        try {
          return await readMorpho({ safeAddress: address, config });
        } catch (cause) {
          return {
            status: 'failed',
            reason: `The vault position could not be read: ${reasonOf(cause)}`,
          };
        }
      },
    ),
  ]);

  const { balances, failure: balancesFailure } = balanceResult;

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

    if (read.usdc === null) {
      // The native read succeeded but the USDC sub-read failed. Surface it as
      // an unread row rather than a silent gap, exactly like a whole chain that
      // could not be read — and carry the sub-read's own reason, so the row says
      // *why* the token amount is unread instead of a generic sentence.
      rows.push({
        key: `${address}:${chain.chainId}:usdc-unread`,
        kind: 'unread',
        chainId: chain.chainId,
        chainName: chain.name,
        symbol: '—',
        name: 'USDC',
        amount: '—',
        usd: null,
        readError:
          read.tokenFailure?.message ??
          `The USDC balance on ${chain.name} could not be read.`,
      });
    } else if (isPositive(read.usdc.amount)) {
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

  for (let index = 0; index < configs.length; index += 1) {
    const morphoConfig = configs[index] as MorphoVaultConfig;
    const position = morphoPositions[index] as MorphoPositionRead;

    const morphoChainName = chainNameOf(chains, morphoConfig.chainId);

    if (position.status === 'failed') {
      rows.push({
        key: `${address}:${morphoConfig.chainId}:morpho`,
        kind: 'morpho',
        chainId: morphoConfig.chainId,
        chainName: morphoChainName,
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
        chainName: morphoChainName,
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
