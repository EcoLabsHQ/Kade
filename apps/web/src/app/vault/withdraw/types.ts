/**
 * Serialisable shapes shared by the operator-withdrawal route, its server
 * actions and its client screen.
 *
 * Nothing here carries a `bigint` or a server-only import, so the client
 * component can import these types without pulling any server code into the
 * browser bundle.
 */

/** Which asset an operator withdrawal moves out of the Safe. */
export type OperatorWithdrawToken = 'usdc' | 'native';

/** Native coin decimals (wei). Kept here so the client imports no server code. */
export const NATIVE_DECIMALS = 18;
/** USDC decimals, matching the app's existing token read. */
export const USDC_DECIMALS = 6;

/**
 * One supported chain's Safe balances, as read server-side and handed to the
 * client for display. `null` on an amount means the read failed, and its reason
 * is carried alongside — a failed read is never shown as a `0`.
 */
export interface OperatorWithdrawBalance {
  readonly chainId: number;
  readonly chainName: string;
  /** The chain's native coin symbol, e.g. `ETH`. */
  readonly nativeSymbol: string;
  /** Formatted native balance, or null when the read failed. */
  readonly nativeAmount: string | null;
  /** The specific reason the native read failed, or null. */
  readonly nativeReason: string | null;
  /** Formatted USDC balance, or null when the read failed. */
  readonly usdcAmount: string | null;
  /** The specific reason the USDC read failed, or null. */
  readonly usdcReason: string | null;
}
