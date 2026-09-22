import { CHAIN_IDS, chainByChainId } from '@kade/shared';
import {
  checksumAddress,
  marketId,
  type MarketParams,
} from './morpho-abi';

/**
 * Morpho configuration for the one Ethereum-mainnet pool (Week 2, D18).
 *
 * The frozen decision (week-2 contract §2.2, §6.3) is a single Morpho pool on
 * **Ethereum mainnet**. The pool address / market parameters and the chain id
 * are supplied by the project and read from the environment here; they are
 * **never** literals in a component. No mainnet pool address is supplied yet
 * (contract §5, freeze checklist), so every reader returns `null`/`not-configured`
 * rather than a fabricated address, and the UI degrades honestly.
 *
 * Keys (server-only; documented in docs/planning/week-2-todo-02-invest.md):
 *   KADE_MORPHO_MORPHO_ADDRESS   the Morpho Blue contract to call
 *   KADE_MORPHO_LOAN_TOKEN       the market's loan token (USDC)
 *   KADE_MORPHO_COLLATERAL_TOKEN the market's collateral token
 *   KADE_MORPHO_ORACLE           the market's oracle
 *   KADE_MORPHO_IRM              the market's interest-rate model
 *   KADE_MORPHO_LLTV             the market's LLTV, as a decimal uint256 string
 *   KADE_MORPHO_POOL_ID          optional: the expected market id, so config can
 *                                be checked against the id the params derive
 *
 * The chain id is not a separate key: it is resolved from the frozen chain
 * registry for the active `KADE_CHAIN_ENV`, so the pool can only ever be the
 * mainnet one this deliverable freezes.
 */

/** Morpho Blue is deployed identically on mainnet; the address is config. */
export const MORPHO_ENV_KEYS = {
  morpho: 'KADE_MORPHO_MORPHO_ADDRESS',
  loanToken: 'KADE_MORPHO_LOAN_TOKEN',
  collateralToken: 'KADE_MORPHO_COLLATERAL_TOKEN',
  oracle: 'KADE_MORPHO_ORACLE',
  irm: 'KADE_MORPHO_IRM',
  lltv: 'KADE_MORPHO_LLTV',
  poolId: 'KADE_MORPHO_POOL_ID',
} as const;

/** A plain string record so tests can pass an empty or partial environment. */
export type MorphoEnv = Readonly<Record<string, string | undefined>>;

export interface MorphoPoolConfig {
  /** The Morpho Blue contract to call on `chainId`. */
  readonly morpho: `0x${string}`;
  /** The chain the pool lives on — Ethereum mainnet, from the chain registry. */
  readonly chainId: number;
  /** The market to supply into. */
  readonly marketParams: MarketParams;
  /** `keccak256(abi.encode(marketParams))`, the market id. */
  readonly marketId: `0x${string}`;
}

function readString(env: MorphoEnv, key: string): string | null {
  return env[key]?.trim() || null;
}

const DECIMAL = /^\d+$/;

/**
 * Resolve the pool configuration, or `null` when the environment does not
 * supply a complete, well-formed one.
 *
 * Returning `null` (rather than a placeholder) is deliberate: it is what lets
 * the Invest screen say "not configured" instead of building an `approve` and a
 * `supply` against an address nobody controls.
 */
export function readMorphoPoolConfig(env: MorphoEnv = process.env): MorphoPoolConfig | null {
  const morphoRaw = readString(env, MORPHO_ENV_KEYS.morpho);
  const loanRaw = readString(env, MORPHO_ENV_KEYS.loanToken);
  const collateralRaw = readString(env, MORPHO_ENV_KEYS.collateralToken);
  const oracleRaw = readString(env, MORPHO_ENV_KEYS.oracle);
  const irmRaw = readString(env, MORPHO_ENV_KEYS.irm);
  const lltvRaw = readString(env, MORPHO_ENV_KEYS.lltv);
  if (!morphoRaw || !loanRaw || !collateralRaw || !oracleRaw || !irmRaw || !lltvRaw) {
    return null;
  }
  if (!DECIMAL.test(lltvRaw)) return null;

  let morpho: `0x${string}`;
  let marketParams: MarketParams;
  try {
    // Every address is parsed inside the guard: a malformed value anywhere —
    // including the Morpho contract itself — must fail closed to `null`, never
    // throw out of the reader and take the route down.
    morpho = checksumAddress(morphoRaw, MORPHO_ENV_KEYS.morpho);
    marketParams = {
      loanToken: checksumAddress(loanRaw, MORPHO_ENV_KEYS.loanToken),
      collateralToken: checksumAddress(collateralRaw, MORPHO_ENV_KEYS.collateralToken),
      oracle: checksumAddress(oracleRaw, MORPHO_ENV_KEYS.oracle),
      irm: checksumAddress(irmRaw, MORPHO_ENV_KEYS.irm),
      lltv: BigInt(lltvRaw),
    };
  } catch {
    return null;
  }

  // The expected pool id is optional. When supplied it must equal the id the
  // parameters derive, so a typo in one parameter cannot silently point at a
  // different market than the operator intended.
  const expectedId = readString(env, MORPHO_ENV_KEYS.poolId);
  const derivedId = marketId(marketParams);
  if (expectedId && expectedId.toLowerCase() !== derivedId.toLowerCase()) {
    return null;
  }

  return {
    morpho,
    chainId: CHAIN_IDS.ethereum,
    marketParams,
    marketId: derivedId,
  };
}

/** Whether the pool is configured well enough to build a deposit call. */
export function isMorphoConfigured(env: MorphoEnv = process.env): boolean {
  return readMorphoPoolConfig(env) !== null;
}

/**
 * The chain id the configured pool must live on.
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
