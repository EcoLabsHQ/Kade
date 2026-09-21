import { getAddress, keccak256, toHex, type Address, type Hex } from 'viem';

/**
 * The pre-approval fee payment rail (week-1 contract section 8.9 / v1.9).
 *
 * A resident pays the configured fee as a direct USDC transfer to the Kade
 * treasury on Ethereum Sepolia. The payment is proved from the transaction
 * receipt — never from anything the browser says — so this module holds the
 * receipt check and nothing else. It is deliberately free of Supabase and
 * `next/*` imports, so it can be exercised in a plain test with a fake reader.
 *
 * The stored transaction hash on `applications.fee_tx` is a **claim, not a
 * proof**: the read path calls `verifyUsdcPayment` again rather than trusting
 * it, which is what keeps a fabricated hash from being presented as paid.
 */

/** USDC has six decimals; the fee is expressed in whole USDC. */
export const USDC_DECIMALS = 6;

/**
 * One included block is enough for the demo rail.
 *
 * A successful Sepolia receipt is the evidence the step asks for; requiring
 * more confirmations would only make the payment screen wait for no product
 * benefit at this maturity. Raising it is a one-line change here.
 */
export const MIN_FEE_CONFIRMATIONS = 1;

/** ERC-20 `Transfer(address,address,uint256)` topic0, computed, not pasted. */
export const ERC20_TRANSFER_TOPIC: Hex = keccak256(
  toHex('Transfer(address,address,uint256)'),
);

export interface ReceiptLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

export interface TransactionReceiptView {
  readonly status: 'success' | 'reverted';
  readonly blockNumber: bigint;
  readonly logs: readonly ReceiptLog[];
}

/**
 * The narrow chain surface the verifier needs.
 *
 * Injecting it (rather than building a viem client here) lets a test supply
 * receipts without an RPC endpoint, which is the same seam
 * `createPreDepositStore` uses for its client.
 */
export interface SepoliaReader {
  /** Null when the hash is not mined yet, or the endpoint could not be read. */
  getTransactionReceipt(hash: Hex): Promise<TransactionReceiptView | null>;
  getBlockNumber(): Promise<bigint>;
}

export type PaymentVerification =
  | {
      readonly status: 'paid';
      readonly from: Address;
      readonly amountUnits: bigint;
    }
  | { readonly status: 'pending' }
  | { readonly status: 'failed' }
  | { readonly status: 'underpaid'; readonly receivedUnits: bigint }
  | { readonly status: 'no-transfer' };

export interface VerifyUsdcPaymentInput {
  readonly reader: SepoliaReader;
  readonly txHash: Hex;
  /** The token contract that must have emitted the transfer. */
  readonly token: Address;
  /** The recipient the transfer must name — the Kade treasury. */
  readonly to: Address;
  /** The smallest acceptable transfer, in the token's smallest unit. */
  readonly minimumUnits: bigint;
}

/** The payment state the fee step renders from, resolved on the server. */
export type FeePaymentState =
  | { readonly status: 'none' }
  | { readonly status: 'paid'; readonly txHash: Hex }
  /** Recorded, but the receipt did not confirm it. Never shown as paid. */
  | { readonly status: 'unverified'; readonly txHash: Hex }
  | { readonly status: 'not-configured' };

/** The outcome of a record attempt, as the payment screen needs it. */
export type RecordFeeResult =
  | { readonly status: 'paid'; readonly txHash: Hex }
  | { readonly status: 'pending' }
  | { readonly status: 'failed' }
  | {
      readonly status: 'underpaid';
      readonly requiredUsdc: string;
      readonly receivedUsdc: string;
    }
  | { readonly status: 'no-transfer' }
  | { readonly status: 'unauthenticated' }
  | { readonly status: 'no-application' }
  | { readonly status: 'not-configured' }
  | { readonly status: 'invalid-hash' }
  | { readonly status: 'error' };

function addressFromTopic(topic: Hex | undefined): Address | null {
  if (!topic || topic.length !== 66) return null;
  try {
    return getAddress(`0x${topic.slice(26)}`);
  } catch {
    return null;
  }
}

function decodeTransfer(
  log: ReceiptLog,
): { readonly from: Address; readonly to: Address; readonly value: bigint } | null {
  if (log.topics.length !== 3) return null;
  const topic0 = log.topics[0];
  if (
    !topic0 ||
    topic0.toLowerCase() !== ERC20_TRANSFER_TOPIC.toLowerCase()
  ) {
    return null;
  }
  const from = addressFromTopic(log.topics[1]);
  const to = addressFromTopic(log.topics[2]);
  if (!from || !to) return null;
  let value: bigint;
  try {
    value = BigInt(log.data);
  } catch {
    return null;
  }
  return { from, to, value };
}

/**
 * Prove a USDC transfer to `to` of at least `minimumUnits`.
 *
 * Only a successful receipt whose logs contain a matching `Transfer` from the
 * configured token to the configured recipient counts. A reverted transaction,
 * a pending one, a wrong token, a wrong recipient and an underpayment each get
 * their own result so the screen can say something true.
 */
export async function verifyUsdcPayment(
  input: VerifyUsdcPaymentInput,
): Promise<PaymentVerification> {
  const receipt = await input.reader.getTransactionReceipt(input.txHash);
  if (receipt === null) return { status: 'pending' };
  if (receipt.status !== 'success') return { status: 'failed' };

  const confirmations =
    (await input.reader.getBlockNumber()) - receipt.blockNumber + 1n;
  if (confirmations < BigInt(MIN_FEE_CONFIRMATIONS)) return { status: 'pending' };

  const token = input.token.toLowerCase();
  const to = input.to.toLowerCase();
  let best: bigint | null = null;
  let from: Address | null = null;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== token) continue;
    const transfer = decodeTransfer(log);
    if (!transfer) continue;
    if (transfer.to.toLowerCase() !== to) continue;
    if (best === null || transfer.value > best) {
      best = transfer.value;
      from = transfer.from;
    }
  }

  if (best === null || from === null) return { status: 'no-transfer' };
  if (best < input.minimumUnits) {
    return { status: 'underpaid', receivedUnits: best };
  }
  return { status: 'paid', from, amountUnits: best };
}
