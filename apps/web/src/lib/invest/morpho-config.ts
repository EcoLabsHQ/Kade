import {
  CHAIN_IDS,
  chainByChainId,
  morphoVaultDeploymentForChain,
  rpcEnvVarForChain,
} from '@kade/shared';
import { checksumAddress } from './morpho-abi';

/**
 * MetaMorpho vault configuration (Week 2, D18 / EXE-014), now **per chain**.
 *
 * The rail is one MetaMorpho USDC vault **per chain**: Ethereum mainnet, Base
 * and Arbitrum One. The vault address, its underlying USDC and the chain id
 * are the whole configuration; there are no market parameters and no market id.
 *
 * The pinned addresses live in one place, `@kade/shared`'s
 * `METAMORPHO_VAULT_DEPLOYMENTS` (`packages/shared/src/morpho-vaults.ts`), the
 * same package the repo uses for every other pinned chain/deployment address.
 * This module never carries an address literal: it resolves the chain's entry
 * and normalises it for viem, and a chain absent from the registry has **no**
 * rail rather than a borrowed one.
 *
 * ## Explicit chain selection, and the legacy env override
 *
 * A caller that names a chain uses `readMorphoVaultConfigForChain(chainId)`;
 * that is the explicit rail and it never falls back to another chain's vault.
 *
 * The historic, single-vault API — `readMorphoVaultConfig(env)` and friends —
 * is kept for the callers frozen on the mainnet-only screen. It continues to
 * read the `KADE_MORPHO_VAULT_ADDRESS` / `KADE_MORPHO_USDC_ADDRESS` pair as an
 * **override** and returns `null` when it is absent; it is the Ethereum-mainnet
 * rail and nothing else. Migrating the Invest screen to the explicit API is a
 * later task (T23 dependency).
 *
 * ## The env override
 *
 * The env pair has always meant "the Ethereum-mainnet vault". It stays an
 * override for the explicit Ethereum rail too. A **partial** pair is a
 * misconfiguration and fails closed (it does not silently fall back to the
 * pinned entry); a malformed value fails loudly with the offending variable's
 * name and then fails closed to `null`, so a typo surfaces without taking the
 * route down. The pair never overrides another chain.
 */

/** The addresses the legacy mainnet rail reads; the chain id is Ethereum. */
export const MORPHO_VAULT_ENV_KEYS = {
  vault: 'KADE_MORPHO_VAULT_ADDRESS',
  usdc: 'KADE_MORPHO_USDC_ADDRESS',
} as const;

/** A plain string record so tests can pass an empty or partial environment. */
export type MorphoEnv = Readonly<Record<string, string | undefined>>;

export interface MorphoVaultConfig {
  /** The MetaMorpho vault to deposit into on `chainId`. */
  readonly vault: `0x${string}`;
  /** The vault's underlying USDC, the token the Safe approves. */
  readonly usdc: `0x${string}`;
  /** The chain the vault lives on, from the frozen chain registry. */
  readonly chainId: number;
}

function readString(env: MorphoEnv, key: string): string | null {
  return env[key]?.trim() || null;
}

/**
 * Normalise the pinned registry entry for `chainId` into a `MorphoVaultConfig`.
 *
 * The registry values are compile-time constants, so a malformed one is a
 * programming error caught by the tests that pin the exact addresses; the
 * `checksumAddress` call is what makes them safe to hand straight to viem's ABI
 * encoder (`readContract`/`encodeFunctionData`) regardless of how the literal
 * is written. `undefined` when the chain has no pinned deployment.
 */
function pinnedConfig(chainId: number): MorphoVaultConfig | null {
  const deployment = morphoVaultDeploymentForChain(chainId);
  if (!deployment) {
    return null;
  }
  return {
    vault: checksumAddress(
      deployment.vault.value,
      `METAMORPHO_VAULT_DEPLOYMENTS[${chainId}].vault`,
    ),
    usdc: checksumAddress(
      deployment.usdc.value,
      `METAMORPHO_VAULT_DEPLOYMENTS[${chainId}].usdc`,
    ),
    chainId,
  };
}

/**
 * Resolve the env override for the Ethereum-mainnet rail.
 *
 * Returns:
 *   - `null` and `used: false` when neither variable is present (no override,
 *     so the pinned entry applies);
 *   - `null` and `used: true` when the pair is partial or malformed (a
 *     misconfiguration: fail closed, do not fall back);
 *   - the normalised config and `used: true` when both are present and valid.
 */
function readEthereumOverride(
  env: MorphoEnv,
): { readonly used: boolean; readonly config: MorphoVaultConfig | null } {
  const vaultRaw = readString(env, MORPHO_VAULT_ENV_KEYS.vault);
  const usdcRaw = readString(env, MORPHO_VAULT_ENV_KEYS.usdc);
  if (!vaultRaw && !usdcRaw) {
    return { used: false, config: null };
  }
  if (!vaultRaw || !usdcRaw) {
    return { used: true, config: null };
  }
  try {
    return {
      used: true,
      config: {
        vault: checksumAddress(vaultRaw, MORPHO_VAULT_ENV_KEYS.vault),
        usdc: checksumAddress(usdcRaw, MORPHO_VAULT_ENV_KEYS.usdc),
        chainId: CHAIN_IDS.ethereum,
      },
    };
  } catch (cause) {
    // `checksumAddress` names the offending variable in its message. Surface
    // that loudly rather than swallowing it, then fail closed so the reader
    // never throws out and takes the route down (F1, commit 956c62d).
    console.warn(`[kade] ${cause instanceof Error ? cause.message : String(cause)}`);
    return { used: true, config: null };
  }
}

/**
 * Resolve the MetaMorpho rail for one explicit chain, or `null`.
 *
 * This is the multichain entry point: the caller names a chain and gets **that
 * chain's** pinned vault. A chain with no pinned deployment resolves to `null`
 * — it never borrows another chain's vault, and there is no implicit default
 * that could send funds to the wrong network.
 *
 * The legacy env pair overrides the Ethereum-mainnet entry only (see the file
 * header); it never reaches Base or Arbitrum.
 */
export function readMorphoVaultConfigForChain(
  chainId: number,
  env: MorphoEnv = process.env,
): MorphoVaultConfig | null {
  if (chainId === CHAIN_IDS.ethereum) {
    const override = readEthereumOverride(env);
    if (override.used) {
      return override.config;
    }
  }
  return pinnedConfig(chainId);
}

/** Whether an explicit chain's vault rail is configured. */
export function isMorphoVaultConfiguredForChain(
  chainId: number,
  env: MorphoEnv = process.env,
): boolean {
  return readMorphoVaultConfigForChain(chainId, env) !== null;
}

/**
 * Whether an explicit chain's rail is fully reachable: a pinned vault **and**
 * the chain's own server-only RPC variable. This is the per-chain counterpart
 * of `isMainnetRailConfigured`; it never substitutes another chain's endpoint.
 */
export function isMorphoRailConfiguredForChain(
  chainId: number,
  env: MorphoEnv = process.env,
): boolean {
  const variable = rpcEnvVarForChain(chainId);
  return (
    isMorphoVaultConfiguredForChain(chainId, env) &&
    Boolean(variable && env[variable]?.trim())
  );
}

/**
 * Resolve the legacy Ethereum-mainnet vault configuration, or `null`.
 *
 * This is the pre-multichain reader: it reads the env override pair and reports
 * `null` when it is absent or partial. It is kept for the callers frozen on the
 * mainnet-only screen (`vault-holdings.ts`, `app/invest/actions.ts`) and for the
 * existing tests; new code should prefer `readMorphoVaultConfigForChain`.
 *
 * `checksumAddress` normalises every value to EIP-55, so a 20-byte address with
 * a wrong or missing checksum is handed out in the form viem's ABI encoder
 * accepts. A missing pair is not a misconfiguration, so it quietly resolves to
 * `null`; a present but malformed value fails loudly (naming the variable) and
 * then fails closed to `null`.
 */
export function readMorphoVaultConfig(
  env: MorphoEnv = process.env,
): MorphoVaultConfig | null {
  return readEthereumOverride(env).config;
}

/** Whether the legacy vault configuration is well enough set to build. */
export function isMorphoVaultConfigured(env: MorphoEnv = process.env): boolean {
  return readMorphoVaultConfig(env) !== null;
}

/**
 * Whether the vault rail — the Ethereum-mainnet MetaMorpho deposit — is
 * configured well enough to build a deposit.
 *
 * The owner's model is **mixed** (contract v1.9, §8): the vault is on Ethereum
 * mainnet, while the pre-approval fee and the remaining tooling stay on Sepolia.
 * A single global `KADE_CHAIN_ENV` cannot express that, so the rail is judged on
 * its own two pieces — a complete vault configuration and the reserved mainnet
 * `ETHEREUM_RPC_URL` — and never on `KADE_CHAIN_ENV`, which may legitimately
 * read `testnet` while the vault path is live.
 *
 * It stays honest: false when the vault address, the underlying USDC or the
 * mainnet RPC is missing. It lives here rather than on the route so it has a
 * name and a test of its own; the `beginDeposit` action resolves it server-side
 * and never takes a gate flag from the caller.
 */
export function isMainnetRailConfigured(env: MorphoEnv = process.env): boolean {
  return isMorphoVaultConfigured(env) && Boolean(env.ETHEREUM_RPC_URL?.trim());
}

/**
 * The chain id the legacy configured vault must live on.
 *
 * Read from the frozen chain registry in `@kade/shared`, never hard-coded in a
 * component. The legacy rail is the Ethereum-mainnet vault, so this is
 * `CHAIN_IDS.ethereum`; explicit multichain callers name their own chain.
 */
export function morphoChainId(): number {
  return CHAIN_IDS.ethereum;
}

/**
 * The chain's human name, for a message that names where funds must be.
 *
 * Defaults to the legacy Ethereum-mainnet rail, so existing zero-argument
 * callers are unchanged; pass a chain id for an explicit rail.
 */
export function morphoChainName(chainId: number = CHAIN_IDS.ethereum): string {
  return chainByChainId(chainId)?.name ?? `chain ${chainId}`;
}
