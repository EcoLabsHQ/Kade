import { formatUnits, getAddress, parseUnits, type Hex } from 'viem';
import { CHAIN_IDS, chainByChainId, type Address } from '@kade/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readSepoliaRpcUrl, readTreasuryAddress } from '@/lib/env';
import {
  USDC_DECIMALS,
  verifyUsdcPayment,
  type FeePaymentState,
  type PaymentVerification,
  type RecordFeeResult,
} from './preapproval-fee';
import { createSepoliaReader } from './sepolia-reader';

/**
 * The server half of the pre-approval fee payment (contract section 8.9).
 *
 * This is the only place the treasury address, the RPC endpoint, the token and
 * the amount are assembled, and none of them come from the browser. The write
 * goes through `record_preapproval_fee_tx`, a SECURITY DEFINER function scoped
 * to the caller's own application, so no service-role key is involved.
 *
 * The stored `applications.fee_tx` is a claim: both the write path and the read
 * path re-derive "paid" from the Sepolia receipt with `verifyUsdcPayment`,
 * never from the hash being present.
 */

const TX_HASH_PATTERN = /^0x[0-9a-f]{64}$/;

export interface FeePaymentConfig {
  readonly treasury: Address;
  readonly token: Address;
  readonly chainId: number;
  readonly rpcUrl: string;
}

/**
 * Whether the fee rail can actually run: treasury, USDC and the RPC verifier.
 *
 * The page gates the payment control on this rather than on the treasury and
 * the wallet project id alone, so a missing `SEPOLIA_RPC_URL` disables the
 * button instead of letting a resident send funds the server could never
 * verify.
 */
export function isFeePaymentConfigured(): boolean {
  return readFeePaymentConfig() !== null;
}

/**
 * The payment configuration, or null when the environment cannot support it.
 *
 * Returning null (rather than throwing) lets the fee step say "not configured"
 * instead of rendering a payment button that could only fail.
 */
export function readFeePaymentConfig(): FeePaymentConfig | null {
  const treasury = readTreasuryAddress();
  const rpcUrl = readSepoliaRpcUrl();
  const chain = chainByChainId(CHAIN_IDS.sepolia);
  const token = chain?.usdcAddress.value;
  if (!treasury || !rpcUrl || !token) return null;
  return {
    treasury: treasury as Address,
    token: token as Address,
    chainId: CHAIN_IDS.sepolia,
    rpcUrl,
  };
}

interface ApplicationFeeRow {
  readonly id: string;
  readonly preapproval_usdc: number | string | null;
  readonly fee_tx: string | null;
}

async function loadApplicationFeeRow(
  profileId: string,
): Promise<ApplicationFeeRow | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from('applications')
    .select('id, preapproval_usdc, fee_tx')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) {
    throw new Error(`Loading the application failed: ${error.message}`);
  }
  return (data as ApplicationFeeRow | null) ?? null;
}

function minimumUnitsFor(row: ApplicationFeeRow): bigint | null {
  if (row.preapproval_usdc === null || row.preapproval_usdc === undefined) {
    return null;
  }
  try {
    const units = parseUnits(String(row.preapproval_usdc), USDC_DECIMALS);
    return units > 0n ? units : null;
  } catch {
    return null;
  }
}

function verifyAgainst(
  config: FeePaymentConfig,
  txHash: Hex,
  minimumUnits: bigint,
): Promise<PaymentVerification> {
  return verifyUsdcPayment({
    reader: createSepoliaReader(config.rpcUrl),
    txHash,
    token: config.token,
    to: config.treasury,
    minimumUnits,
  });
}

/**
 * The resident's fee payment state, re-derived from the chain.
 *
 * `none` when nothing is recorded; `paid` only when the recorded hash still
 * verifies against the receipt; `unverified` when a hash is recorded but cannot
 * be confirmed (so the screen never presents it as paid); `not-configured` when
 * the treasury or RPC is absent.
 */
export async function loadFeePayment(
  profileId: string,
): Promise<FeePaymentState> {
  const config = readFeePaymentConfig();
  if (!config) return { status: 'not-configured' };

  const row = await loadApplicationFeeRow(profileId);
  if (!row?.fee_tx) return { status: 'none' };

  const txHash = row.fee_tx as Hex;
  // Without a positive, server-resolved minimum there is nothing to prove the
  // transfer against, so a recorded hash stays unverified rather than being
  // accepted on a default.
  const minimumUnits = minimumUnitsFor(row);
  if (minimumUnits === null) return { status: 'unverified', txHash };

  const verification = await verifyAgainst(config, txHash, minimumUnits);
  return verification.status === 'paid'
    ? { status: 'paid', txHash }
    : { status: 'unverified', txHash };
}

/** Record the hash after verifying the receipt, then return the outcome. */
async function writeFeeTx(txHash: string): Promise<boolean> {
  const client = await createSupabaseServerClient();
  const { error } = await client.rpc('record_preapproval_fee_tx', {
    p_tx_hash: txHash,
  });
  if (error) {
    console.error(
      '[kade] recording the pre-approval fee transaction failed:',
      error.message,
    );
    return false;
  }
  return true;
}

/**
 * Normalize a connected wallet address, or null when it is not one.
 *
 * `getAddress` checksums and validates; comparing checksummed forms (rather
 * than lowercasing) is what the review asked for, and it rejects anything that
 * is not a real address instead of quietly failing to match.
 */
function normalizePayer(rawPayer: string): Address | null {
  try {
    return getAddress(rawPayer.trim());
  } catch {
    return null;
  }
}

/**
 * Verify a Sepolia receipt for the fee and record the hash when it proves out.
 *
 * The amount is the server-resolved `applications.preapproval_usdc`, never a
 * client value. The transfer must also name the connected wallet as its
 * sender: `verifyUsdcPayment` returns the receipt's `from`, and a payment sent
 * by a different wallet is refused, so a resident cannot claim someone else's
 * treasury transfer as their own.
 *
 * The recorded hash is a replaceable claim, not an immutable record: a
 * submitted hash is verified on its own and, when it proves out, replaces
 * whatever claim was stored. "Paid" is always re-derived from the receipt, so
 * an old or fabricated claim cannot lock a resident out of recording the real
 * payment.
 */
export async function recordFeePayment(
  profileId: string,
  rawTxHash: string,
  rawPayer: string,
): Promise<RecordFeeResult> {
  const config = readFeePaymentConfig();
  if (!config) return { status: 'not-configured' };

  const txHash = rawTxHash.trim().toLowerCase();
  if (!TX_HASH_PATTERN.test(txHash)) return { status: 'invalid-hash' };

  const payer = normalizePayer(rawPayer);
  if (payer === null) return { status: 'wrong-sender' };

  const row = await loadApplicationFeeRow(profileId);
  if (!row) return { status: 'no-application' };

  const minimumUnits = minimumUnitsFor(row);
  if (minimumUnits === null) return { status: 'error' };

  // The recorded hash is not consulted: a submitted hash is verified on its own
  // and, when it proves out, replaces whatever claim was stored. That is what
  // lets a resident who recorded an earlier (wrong) hash still record the real
  // payment.
  const verification = await verifyAgainst(config, txHash as Hex, minimumUnits);

  switch (verification.status) {
    case 'paid': {
      if (getAddress(verification.from) !== payer) {
        return { status: 'wrong-sender' };
      }
      if (!(await writeFeeTx(txHash))) return { status: 'error' };
      return { status: 'paid', txHash: txHash as Hex };
    }
    case 'pending':
      return { status: 'pending' };
    case 'failed':
      return { status: 'failed' };
    case 'underpaid':
      return {
        status: 'underpaid',
        requiredUsdc: formatUnits(minimumUnits, USDC_DECIMALS),
        receivedUsdc: formatUnits(verification.receivedUnits, USDC_DECIMALS),
      };
    case 'no-transfer':
      return { status: 'no-transfer' };
  }
}
