import { chainByChainId, rpcEnvVarForChain } from '@kade/shared';
import { createPublicClient, formatUnits, http, type Address } from 'viem';
import { METAMORPHO_VAULT_ABI } from './morpho-abi';
import { USDC_DECIMALS } from './morpho-deposit';
import { VIEM_CHAIN_BY_ID, chainNameOf } from './safe-usdc-balance';

/**
 * The resident Safe's MetaMorpho **share** balance on the vault's chain, and
 * the gate that refuses an un-allocate the Safe cannot cover.
 *
 * This is the inverse of {@link checkSafeDepositFunding} in
 * `./safe-usdc-balance.ts`, with the same shape and the same honesty rules.
 * A deposit pulls USDC from the Safe; an un-allocate instead **burns shares the
 * Safe already holds**. A Safe that holds too few shares for the requested USDC
 * can never execute the operation, so the read happens **before** anything is
 * built and the refusal names the chain and the shortfall rather than reaching
 * the bundler as an opaque simulation revert.
 *
 * The MetaMorpho share token has 18 decimals while its underlying USDC has 6,
 * so the two figures are not interchangeable: the Safe's share balance is read
 * and then valued through the **vault's own** `convertToAssets`, never a
 * hard-coded or assumed ratio. Because `convertToAssets` rounds down, a share
 * balance worth at least the requested USDC is guaranteed to cover the exact
 * shares `withdraw` needs (which rounds the required shares up).
 *
 * A failed read is **not** a pass. It is neither assumed sufficient nor assumed
 * zero (which would wrongly refuse a funded Safe); it is refused with the real
 * read failure, and the two refusals are distinguished by gate. `convertToAssets`
 * returning zero for a non-zero share balance is impossible for a well-behaved
 * vault, so it is treated as a real insufficient balance, never fabricated.
 */

/** One share-balance read outcome: the raw shares and their USDC value. */
export type SafeVaultShareRead =
  | { readonly status: 'read'; readonly shares: bigint; readonly assetsUsdc: bigint }
  | { readonly status: 'failed'; readonly reason: string };

/** What a share read targets: the Safe, the vault, the chain. */
export interface SafeVaultShareInput {
  /** The resident Safe whose vault shares are read. */
  readonly safeAddress: Address;
  /** The MetaMorpho vault holding the shares, from the app's own resolution. */
  readonly vault: Address;
  /** The chain the un-allocate executes on. */
  readonly chainId: number;
}

/**
 * The read seam. Injected so the gate is unit-testable with no network; defaults
 * to the real vault-chain RPC read.
 */
export type SafeVaultShareReader = (
  input: SafeVaultShareInput,
) => Promise<SafeVaultShareRead>;

/** Why an un-allocate was refused for shares: too few, or unreadable. */
export type SafeWithdrawShareGate =
  | 'safe-insufficient-shares'
  | 'safe-shares-unreadable';

/**
 * The share gate's outcome. `ok` means the Safe's shares cover the requested
 * USDC (or, for "all", that the Safe holds any shares); otherwise the gate and a
 * specific, resident-facing reason are returned.
 */
export type SafeWithdrawShareCheck =
  | { readonly ok: true; readonly shares: bigint; readonly assetsUsdc: bigint }
  | {
      readonly ok: false;
      readonly gate: SafeWithdrawShareGate;
      readonly reason: string;
    };

/** The share gate's input: what to read, and what the request needs. */
export interface SafeWithdrawShareInput extends SafeVaultShareInput {
  /** The chain's human name, so the refusal names where the shares are. */
  readonly chainName: string;
  /**
   * The requested USDC amount in smallest unit, or `null` for "all". For "all"
   * any positive share balance covers the request, so only the balance is read.
   */
  readonly amountUnits: bigint | null;
}

/** A readable message from an unknown thrown value. */
function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Read the Safe's vault share balance, and its USDC value, from the vault
 * chain's RPC.
 *
 * The endpoint is resolved from the chain the un-allocate executes on
 * (`rpcEnvVarForChain`), so a Base redemption reads Base and an Arbitrum one
 * reads Arbitrum. It never falls back to another chain's endpoint: a chain with
 * no supported RPC variable, or one whose variable is unset, is a `failed` read,
 * never a fabricated zero and never a mainnet read.
 */
export async function readSafeVaultSharesFromRpc(
  input: SafeVaultShareInput,
): Promise<SafeVaultShareRead> {
  const variable = rpcEnvVarForChain(input.chainId);
  if (!variable) {
    return {
      status: 'failed',
      reason:
        `chain ${input.chainId} has no RPC variable, so the vault share ` +
        'balance cannot be read',
    };
  }

  const rpcUrl = process.env[variable]?.trim();
  if (!rpcUrl) {
    return {
      status: 'failed',
      reason:
        `the ${chainNameOf(input.chainId)} RPC endpoint (${variable}) is not ` +
        'set, so the vault share balance cannot be read',
    };
  }

  const chain = VIEM_CHAIN_BY_ID[input.chainId];
  if (!chain) {
    return {
      status: 'failed',
      reason:
        `chain ${input.chainId} is not a supported vault chain, so the vault ` +
        'share balance cannot be read',
    };
  }

  try {
    const client = createPublicClient({ chain, transport: http(rpcUrl) });
    const shares = await client.readContract({
      address: input.vault,
      abi: METAMORPHO_VAULT_ABI,
      functionName: 'balanceOf',
      args: [input.safeAddress],
    });
    // The vault's own conversion, never a share-count-equals-USDC assumption.
    const assetsUsdc = await client.readContract({
      address: input.vault,
      abi: METAMORPHO_VAULT_ABI,
      functionName: 'convertToAssets',
      args: [shares],
    });
    return { status: 'read', shares, assetsUsdc };
  } catch (cause) {
    return {
      status: 'failed',
      reason: `the vault share balance read failed: ${reasonOf(cause)}`,
    };
  }
}

/**
 * Check that the Safe's shares cover the requested USDC before anything is
 * built.
 *
 * Order, and why:
 *
 *   1. Read the shares and their USDC value. A thrown or `failed` read refuses
 *      as `safe-shares-unreadable` with the real reason — never assumed
 *      sufficient, and never assumed zero.
 *   2. For "all", require a positive share balance; an empty position refuses
 *      with the chain named.
 *   3. For a stated amount, compare the shares' USDC value to the request. Less
 *      refuses as `safe-insufficient-shares`, naming the chain and the
 *      held/needed amounts (and the shortfall), so the resident knows the vault
 *      position is too small.
 *
 * The reader is injectable, so every branch is testable with no network.
 */
export async function checkSafeWithdrawShares(
  input: SafeWithdrawShareInput,
  reader: SafeVaultShareReader = readSafeVaultSharesFromRpc,
): Promise<SafeWithdrawShareCheck> {
  // The vault chain's name is derived from its id, not trusted from the caller:
  // a message (and a read) must name where the shares actually are, so a caller
  // that mislabels the chain cannot make the refusal lie.
  const chainName = chainByChainId(input.chainId)?.name ?? input.chainName;
  const readInput: SafeWithdrawShareInput = { ...input, chainName };

  let read: SafeVaultShareRead;
  try {
    read = await reader(readInput);
  } catch (cause) {
    read = { status: 'failed', reason: reasonOf(cause) };
  }

  if (read.status === 'failed') {
    return {
      ok: false,
      gate: 'safe-shares-unreadable',
      reason:
        `The Safe\u2019s MetaMorpho share balance on ${chainName} could not be ` +
        `read, so the un-allocate was not built: ${read.reason}.`,
    };
  }

  if (input.amountUnits === null) {
    if (read.shares <= 0n) {
      return {
        ok: false,
        gate: 'safe-insufficient-shares',
        reason:
          `The Safe holds no MetaMorpho shares on ${chainName}, so there is ` +
          'nothing to un-allocate. Allocate into the vault on that chain first.',
      };
    }
    return { ok: true, shares: read.shares, assetsUsdc: read.assetsUsdc };
  }

  if (read.assetsUsdc < input.amountUnits) {
    const held = formatUnits(read.assetsUsdc, USDC_DECIMALS);
    const needed = formatUnits(input.amountUnits, USDC_DECIMALS);
    const shortfall = formatUnits(
      input.amountUnits - read.assetsUsdc,
      USDC_DECIMALS,
    );
    return {
      ok: false,
      gate: 'safe-insufficient-shares',
      reason:
        `The Safe\u2019s MetaMorpho shares are worth ${held} USDC on ` +
        `${chainName}, but this un-allocate needs ${needed} USDC. The Safe does ` +
        `not hold enough shares to cover it \u2014 short by ${shortfall} USDC.`,
    };
  }

  return { ok: true, shares: read.shares, assetsUsdc: read.assetsUsdc };
}
