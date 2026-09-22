import { formatUnits, getAddress, parseUnits, type Hex } from 'viem';
import { chainsForEnv } from '@kade/shared';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  readChainEnv,
  readFeeMode,
  readSepoliaRpcUrl,
  readTreasuryAddress,
} from '@/lib/env';
import { USDC_DECIMALS, type FeePaymentState, type RecordFeeResult } from '@/lib/payments/preapproval-fee';
import { createReceiptReader } from './receipt-reader';
import {
  verifyResidencyServiceFee,
  type PaymentVerification,
  type ResidencyServiceFeeConfig,
} from './service-fee';

/**
 * The server half of the residency service fee (week-2 contract section 2.3).
 *
 * Mirrors `@/lib/payments/server` for the pre-approval fee, with one deliberate
 * difference: the amount is read from `fee_schedule` (key `service`) for the
 * active mode, not from the application row, so "no amount is hard-coded in the
 * client" holds for the second fee as well. The treasury, the RPC endpoint and
 * the token are all assembled here and none of them come from the browser.
 *
 * The write goes through `record_residency_service_fee_tx`, a SECURITY DEFINER
 * function scoped to the caller's own application, so no service-role key is
 * involved. The stored hash is a claim: both the write path and the read path
 * re-derive "paid" from the receipt, never from the hash being present.
 *
 * The chain is the active environment's settlement chain. On the testnet
 * configuration that is Ethereum Sepolia; on mainnet it is Ethereum, whose RPC
 * and treasury are supplied by the mainnet configuration front. When those are absent the rail reports
 * `not-configured` rather than pointing at an address nobody controls.
 */

const TX_HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** The mainnet settlement endpoint, owned by the mainnet-config front. */
function readMainnetRpcUrl(): string | null {
  return process.env.ETHEREUM_RPC_URL?.trim() || null;
}

/** The mainnet treasury, owned by the mainnet-config front. */
function readMainnetTreasuryAddress(): string | null {
  const value = process.env.MAINNET_TREASURY_ADDRESS?.trim();
  if (!value) return null;
  if (!ADDRESS_PATTERN.test(value)) {
    console.warn(
      '[kade] MAINNET_TREASURY_ADDRESS is not a 20-byte hex address; ignoring it.',
    );
    return null;
  }
  return value;
}

/**
 * The active settlement chain's service-fee configuration, or null when the
 * environment cannot support a verifiable payment.
 *
 * Returning null (rather than throwing) lets the step say "not configured"
 * instead of rendering a payment control that could only fail.
 */
export function readResidencyServiceFeeConfig(): ResidencyServiceFeeConfig | null {
  const chainEnv = readChainEnv();
  const chains = chainsForEnv(chainEnv);
  const settlement = chains.find((chain) => chain.key === 'ethereum') ?? chains[0];
  if (!settlement) return null;

  const treasury =
    chainEnv === 'mainnet' ? readMainnetTreasuryAddress() : readTreasuryAddress();
  const rpcUrl =
    chainEnv === 'mainnet' ? readMainnetRpcUrl() : readSepoliaRpcUrl();
  const token = settlement.usdcAddress.value;
  if (!treasury || !rpcUrl || !token) return null;

  return {
    treasury: treasury as ResidencyServiceFeeConfig['treasury'],
    token: token as ResidencyServiceFeeConfig['token'],
    chainId: settlement.chainId,
    rpcUrl,
  };
}

export function isResidencyServiceFeeConfigured(): boolean {
  return readResidencyServiceFeeConfig() !== null;
}

interface ApplicationServiceRow {
  readonly id: string;
  readonly service_tx: string | null;
}

async function loadApplicationServiceRow(
  profileId: string,
): Promise<ApplicationServiceRow | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from('applications')
    .select('id, service_tx')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) {
    throw new Error(`Loading the application failed: ${error.message}`);
  }
  return (data as ApplicationServiceRow | null) ?? null;
}

/**
 * The `fee_schedule` service amount for the active mode.
 *
 * Throws when the read itself fails, so a broken read is never mistaken for "no
 * fee configured"; returns null when the mode has no service row.
 */
export async function resolveResidencyServiceFeeAmount(
  mode = readFeeMode(),
): Promise<number | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from('fee_schedule')
    .select('amount')
    .eq('mode', mode)
    .eq('key', 'service')
    .maybeSingle();
  if (error) {
    throw new Error(`Reading the service fee failed: ${error.message}`);
  }
  if (!data) return null;
  const amount = Number((data as { amount: unknown }).amount);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function minimumUnitsFor(amountUsdc: number): bigint | null {
  try {
    const units = parseUnits(String(amountUsdc), USDC_DECIMALS);
    return units > 0n ? units : null;
  } catch {
    return null;
  }
}

function verifyAgainst(
  config: ResidencyServiceFeeConfig,
  txHash: Hex,
  minimumUnits: bigint,
): Promise<PaymentVerification> {
  return verifyResidencyServiceFee({
    reader: createReceiptReader(config.rpcUrl),
    txHash,
    config,
    minimumUnits,
  });
}

/**
 * The resident's service-fee payment state, re-derived from the chain.
 *
 * `none` when nothing is recorded; `paid` only when the recorded hash still
 * verifies; `unverified` when a hash is recorded but cannot be confirmed (so the
 * screen never presents it as paid); `not-configured` when the rail is absent.
 */
export async function loadResidencyServiceFeePayment(
  profileId: string,
): Promise<FeePaymentState> {
  const config = readResidencyServiceFeeConfig();
  if (!config) return { status: 'not-configured' };

  const row = await loadApplicationServiceRow(profileId);
  if (!row?.service_tx) return { status: 'none' };

  const txHash = row.service_tx as Hex;
  const amount = await resolveResidencyServiceFeeAmount();
  const minimumUnits = amount === null ? null : minimumUnitsFor(amount);
  if (minimumUnits === null) return { status: 'unverified', txHash };

  const verification = await verifyAgainst(config, txHash, minimumUnits);
  return verification.status === 'paid'
    ? { status: 'paid', txHash }
    : { status: 'unverified', txHash };
}

async function writeServiceFeeTx(txHash: string): Promise<boolean> {
  const client = await createSupabaseServerClient();
  const { error } = await client.rpc('record_residency_service_fee_tx', {
    p_tx_hash: txHash,
  });
  if (error) {
    console.error(
      '[kade] recording the residency service fee transaction failed:',
      error.message,
    );
    return false;
  }
  return true;
}

function normalizePayer(rawPayer: string): `0x${string}` | null {
  try {
    return getAddress(rawPayer.trim());
  } catch {
    return null;
  }
}

/**
 * Verify a receipt for the service fee and record the hash when it proves out.
 *
 * The amount is the server-resolved `fee_schedule` service amount, never a
 * client value. The transfer must also name the connected wallet as its sender,
 * so a resident cannot claim someone else's treasury transfer. The recorded hash
 * is replaceable, so a wrong first claim cannot lock the resident out.
 */
export async function recordResidencyServiceFeePayment(
  profileId: string,
  rawTxHash: string,
  rawPayer: string,
): Promise<RecordFeeResult> {
  const config = readResidencyServiceFeeConfig();
  if (!config) return { status: 'not-configured' };

  const txHash = rawTxHash.trim().toLowerCase();
  if (!TX_HASH_PATTERN.test(txHash)) return { status: 'invalid-hash' };

  const payer = normalizePayer(rawPayer);
  if (payer === null) return { status: 'wrong-sender' };

  const row = await loadApplicationServiceRow(profileId);
  if (!row) return { status: 'no-application' };

  const amount = await resolveResidencyServiceFeeAmount();
  const minimumUnits = amount === null ? null : minimumUnitsFor(amount);
  if (minimumUnits === null) return { status: 'error' };

  const verification = await verifyAgainst(config, txHash as Hex, minimumUnits);

  switch (verification.status) {
    case 'paid': {
      if (getAddress(verification.from) !== payer) {
        return { status: 'wrong-sender' };
      }
      if (!(await writeServiceFeeTx(txHash))) return { status: 'error' };
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
