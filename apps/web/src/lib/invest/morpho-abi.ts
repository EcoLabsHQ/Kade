import { keccak256, encodeAbiParameters, getAddress, type Address, type Hex } from 'viem';

/**
 * The Morpho Blue interface this build uses (Week 2, D18 / EXE-014).
 *
 * Source: `morpho-org/morpho-blue` `src/interfaces/IMorpho.sol`, and the Morpho
 * docs page "Blue" (`docs.morpho.org/developers/contracts/blue`). The ABI is
 * declared here rather than pulled from an SDK because no Morpho package is
 * installed and the surface needed for one supply is tiny and canonical.
 *
 * A Morpho Blue "pool" is a **market**: an immutable
 * `MarketParams { loanToken, collateralToken, oracle, irm, lltv }` whose
 * `keccak256(abi.encode(...))` is the market `id`. The market parameters are
 * configuration (`./morpho-config.ts`), never literals in this file or in a
 * component.
 *
 * `supply(marketParams, assets, shares, onBehalf, data)` deposits `assets` of
 * the market's `loanToken` (USDC) and credits the resulting supply position to
 * `onBehalf`. Supplying `assets` with `shares = 0` takes exactly that amount of
 * assets, which is what a "deposit this many USDC" call wants: it avoids the
 * share-price slippage a shares-denominated supply would allow.
 */

/** The canonical `MarketParams` tuple, in declaration order. */
export const MARKET_PARAMS_COMPONENTS = [
  { name: 'loanToken', type: 'address' },
  { name: 'collateralToken', type: 'address' },
  { name: 'oracle', type: 'address' },
  { name: 'irm', type: 'address' },
  { name: 'lltv', type: 'uint256' },
] as const;

/** The Morpho Blue supply side, plus the market-id view used to verify config. */
export const MORPHO_BLUE_ABI = [
  {
    type: 'function',
    name: 'supply',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'marketParams',
        type: 'tuple',
        components: MARKET_PARAMS_COMPONENTS,
      },
      { name: 'assets', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
      { name: 'onBehalf', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [
      { name: 'assetsSupplied', type: 'uint256' },
      { name: 'sharesSupplied', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'idToMarketParams',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      { name: 'loanToken', type: 'address' },
      { name: 'collateralToken', type: 'address' },
      { name: 'oracle', type: 'address' },
      { name: 'irm', type: 'address' },
      { name: 'lltv', type: 'uint256' },
    ],
  },
] as const;

/** The four values a `supply` call's `marketParams` tuple carries. */
export interface MarketParams {
  readonly loanToken: Address;
  readonly collateralToken: Address;
  readonly oracle: Address;
  readonly irm: Address;
  readonly lltv: bigint;
}

/**
 * The `marketParams` object viem encodes a named tuple from.
 *
 * viem infers a tuple with named components as an **object**, not an array, so
 * the value passed to `encodeAbiParameters`/`encodeFunctionData` is keyed by
 * field name. The declaration order in `MARKET_PARAMS_COMPONENTS` is what fixes
 * the on-chain order; this object supplies the values.
 */
export function marketParamsTuple(params: MarketParams): MarketParams {
  return params;
}

/**
 * The market id: `keccak256(abi.encode(MarketParams))`.
 *
 * Computed locally so configuration can be checked against the chain, but the
 * chain remains the authority: `idToMarketParams` is what a caller compares
 * against, so a mismatched local encoding is caught rather than trusted.
 */
export function marketId(params: MarketParams): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'tuple', components: MARKET_PARAMS_COMPONENTS }],
      [marketParamsTuple(params)],
    ),
  );
}

/** Normalise and checksum a config-supplied address, throwing when malformed. */
export function checksumAddress(value: string, field: string): Address {
  try {
    return getAddress(value.trim());
  } catch {
    throw new Error(`${field} is not a valid 20-byte hex address: "${value}".`);
  }
}
