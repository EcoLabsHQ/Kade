import { CHAIN_IDS, chainByChainId } from '@kade/shared';
import { checksumAddress } from './morpho-abi';

/**
 * MetaMorpho vault configuration for the one Ethereum-mainnet vault
 * (Week 2, D18 / EXE-014).
 *
 * The frozen decision (week-2 contract §2.2, §6.3) is a single Morpho pool on
 * **Ethereum mainnet**. The owner clarified that this pool is a **MetaMorpho
 * vault**, not a Morpho Blue market: one deployed ERC-4626 contract, with one
 * underlying asset (USDC). The vault address, the underlying USDC address and
 * the chain id are the whole configuration; there are no market parameters and
 * no market id. The addresses are supplied by the project and read from the
 * environment here; they are **never** literals in a component.
 *
 * No mainnet vault address is supplied yet (contract §5, freeze checklist), so
 * every reader returns `null`/`not-configured` rather than a fabricated
 * address, and the UI degrades honestly.
 *
 * Keys (server-only; documented in docs/planning/week-2-todo-02-invest.md):
 *   KADE_MORPHO_VAULT_ADDRESS   the MetaMorpho vault to deposit into
 *   KADE_MORPHO_USDC_ADDRESS    the vault's underlying USDC, the token approved
 *
 * The chain id is not a separate key: it is resolved from the frozen chain
 * registry for the active `KADE_CHAIN_ENV`, so the vault can only ever be the
 * mainnet one this deliverable freezes.
 */

/** The addresses the vault path needs; the chain id comes from the registry. */
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
  /** The chain the vault lives on — Ethereum mainnet, from the chain registry. */
  readonly chainId: number;
}

function readString(env: MorphoEnv, key: string): string | null {
  return env[key]?.trim() || null;
}

/**
 * Resolve the vault configuration, or `null` when the environment does not
 * supply a complete, well-formed one.
 *
 * Returning `null` (rather than a placeholder) is deliberate: it is what lets
 * the Invest screen say "not configured" instead of building an `approve` and a
 * `deposit` against an address nobody controls.
 */
export function readMorphoVaultConfig(
  env: MorphoEnv = process.env,
): MorphoVaultConfig | null {
  const vaultRaw = readString(env, MORPHO_VAULT_ENV_KEYS.vault);
  const usdcRaw = readString(env, MORPHO_VAULT_ENV_KEYS.usdc);
  if (!vaultRaw || !usdcRaw) {
    return null;
  }

  try {
    // Every address is parsed inside the guard: a malformed value anywhere —
    // including the vault contract itself — must fail closed to `null`, never
    // throw out of the reader and take the route down.
    return {
      vault: checksumAddress(vaultRaw, MORPHO_VAULT_ENV_KEYS.vault),
      usdc: checksumAddress(usdcRaw, MORPHO_VAULT_ENV_KEYS.usdc),
      chainId: CHAIN_IDS.ethereum,
    };
  } catch {
    return null;
  }
}

/** Whether the vault is configured well enough to build a deposit call. */
export function isMorphoVaultConfigured(env: MorphoEnv = process.env): boolean {
  return readMorphoVaultConfig(env) !== null;
}

/**
 * The chain id the configured vault must live on.
 *
 * Read from the frozen chain registry in `@kade/shared`, never hard-coded in a
 * component. Mainnet is the frozen decision for Invest (week-2 §6.3), so this is
 * `CHAIN_IDS.ethereum`. When front 00 lands the chain-environment config, this
 * resolves through the registry the same way; the constant is the registry's,
 * not a literal in this file.
 */
export function morphoChainId(): number {
  return CHAIN_IDS.ethereum;
}

/** Exposed so the UI and tests can name the chain without importing the registry. */
export function morphoChainName(): string {
  return chainByChainId(CHAIN_IDS.ethereum)?.name ?? 'Ethereum';
}
