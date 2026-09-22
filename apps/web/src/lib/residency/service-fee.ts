import type { Address, Hex } from 'viem';
import {
  verifyUsdcPayment,
  type PaymentVerification,
  type TransactionReceiptView,
  type FeePaymentState,
  type RecordFeeResult,
} from '@/lib/payments/preapproval-fee';

/**
 * The residency service fee receipt check (week-2 contract section 2.3 / D16).
 *
 * The rail is deliberately the same one as the pre-approval fee (D10): a
 * resident sends a direct USDC transfer to the Kade treasury on the approved
 * chain, and the server proves it from the transaction receipt rather than from
 * anything the browser says. Rather than copy `verifyUsdcPayment`, this module
 * reuses it, so the two fees cannot drift in how a payment is recognised.
 *
 * Kept free of Supabase and `next/*` imports so it is exercised in a plain test
 * with a fake reader. The chain is not named here: the caller supplies the
 * config, which `./service-fee-server` resolves from the active environment.
 */

/** The narrow chain surface the verifier needs (same shape as the fee rail). */
export interface ReceiptReader {
  getTransactionReceipt(hash: Hex): Promise<TransactionReceiptView | null>;
  getBlockNumber(): Promise<bigint>;
}

export interface ResidencyServiceFeeConfig {
  /** The Kade treasury that must receive the transfer. */
  readonly treasury: Address;
  /** The USDC contract that must have emitted the transfer. */
  readonly token: Address;
  /** The chain the payment is verified on. */
  readonly chainId: number;
  /** A server-only RPC endpoint used to read the receipt. */
  readonly rpcUrl: string;
}

export interface VerifyResidencyServiceFeeInput {
  readonly reader: ReceiptReader;
  readonly txHash: Hex;
  readonly config: ResidencyServiceFeeConfig;
  /** The smallest acceptable transfer, in USDC's smallest unit. */
  readonly minimumUnits: bigint;
}

/**
 * Prove a USDC transfer to the treasury of at least the service fee.
 *
 * Every rejection reason `verifyUsdcPayment` distinguishes is preserved, so the
 * screen can say something true instead of collapsing to "failed".
 */
export function verifyResidencyServiceFee(
  input: VerifyResidencyServiceFeeInput,
): Promise<PaymentVerification> {
  return verifyUsdcPayment({
    reader: input.reader,
    txHash: input.txHash,
    token: input.config.token,
    to: input.config.treasury,
    minimumUnits: input.minimumUnits,
  });
}

export type { PaymentVerification, FeePaymentState, RecordFeeResult };
