'use server';

import { MORPHO_VAULT_CHAIN_IDS, chainByChainId } from '@kade/shared';
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  type Address,
} from 'viem';
import { getSessionUser } from '@/lib/supabase/server';
import { loadPasskeyCredential } from '@/app/account/passkey-actions';
import { parseP256PublicKey } from '@/lib/passkey/public-key';
import { toPasskeySigner, type PasskeySigner } from '@/lib/safe/passkey-signer';
import { loadShellSafe } from '@/lib/safe/shell';
import {
  deriveAccountFromPasskey,
  type DerivedAccount,
} from '@/lib/safe/derive-account';
import {
  buildResidentSafeBatchFromEnv,
  submitResidentSafeOperationFromEnv,
} from '@/lib/safe/execute-safe-4337-env';
import type {
  SafeAssertionParts,
  SafeCall,
  SafeSubmitOutcome,
} from '@/lib/safe/execute-safe-4337';
import { usdcAddressForChain } from '@/lib/wealth/evm';
import { readSafeTokenBalance } from './balances';
import { OPERATOR_WITHDRAW_ENV, isOperatorWithdrawEnabled } from './gate';
import {
  NATIVE_DECIMALS,
  USDC_DECIMALS,
  type OperatorWithdrawToken,
} from './types';

/**
 * The operator-withdrawal server actions.
 *
 * This is the inverse of the Invest deposit: it moves funds **out** of the
 * resident's Safe to a destination the operator names. It is deliberately
 * unlinked, off by default (`KADE_OPERATOR_WITHDRAW=1`) and documented in
 * `docs/operator-vault-withdraw.md`; it is not a covert backdoor.
 *
 * The authority model is unchanged: the Safe's only signer is the resident's
 * WebAuthn passkey, so the operator cannot move anything without that passkey's
 * assertion. The connected browser EOA has no authority and is never used. Both
 * actions reuse the **same** Safe-4337 seam as the Invest flow
 * (`buildResidentSafeBatchFromEnv` / `submitResidentSafeOperationFromEnv`); no
 * new signer or submission path is introduced.
 *
 * The flow is the same two phases:
 *
 *   1. `beginOperatorWithdraw` — server, no signing. Resolves the session, the
 *      stored credential and the **recorded** Safe, validates the destination,
 *      the amount (a positive base-unit integer within the Safe's balance on
 *      that chain) and the chain (Ethereum mainnet, Base or Arbitrum One),
 *      builds the single transfer call and retains the Safe operation. Returns
 *      only `{ token, hash, credentialId, chainId }`.
 *   2. `completeOperatorWithdraw` — server, after the browser signs. Takes only
 *      `{ token, assertion, chainId }`, resolves the same signer and Safe, and
 *      submits the retained operation. Success is reported only for a confirmed
 *      receipt; every refusal names its stage and reason.
 *
 * The chain is always **explicit** and validated server-side against the pinned
 * vault-chain registry; no other chain is ever substituted.
 */

/** The zero address, refused as a withdrawal destination. */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** What the client receives when it asks to build (not send) a withdrawal. */
export type BuildOperatorWithdrawResult =
  | {
      readonly status: 'gated';
      readonly gate: string;
      readonly reason: string;
    }
  | {
      readonly status: 'ready';
      /** A cryptographically random, single-use token for the retained operation. */
      readonly token: string;
      /** The SafeOp EIP-712 hash the passkey must sign, as hex. */
      readonly hash: string;
      /** The credential id in the hex form Safe and the WebAuthn prompt use. */
      readonly credentialId: string;
      /** The chain the retained operation was built for, resolved server-side. */
      readonly chainId: number;
    };

/**
 * What the client receives when it submits the signed withdrawal.
 *
 * The success variant exists only for a **confirmed receipt**; every refusal is
 * a `failed` outcome that names the stage it stopped at, so a built or
 * submitted operation can never be mistaken for a withdrawal.
 */
export type CompleteOperatorWithdrawResult =
  | SafeSubmitOutcome
  | {
      readonly status: 'failed';
      readonly sent: false;
      /** The refusal happened before the engine, resolving the signer/Safe. */
      readonly stage: 'resolve';
      readonly reason: string;
    };

/** The server-held facts a withdrawal needs, resolved from the session. */
type OperatorContext =
  | {
      readonly ok: true;
      readonly signer: PasskeySigner;
      readonly safeAddress: Address;
      /** Safe's hex credential id, for the browser's `allowCredentials`. */
      readonly credentialId: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolve the signed-in resident's withdrawal context from server-held state.
 *
 * The signer comes from the **stored credential** and the Safe from the
 * deployment record — neither is named by the caller. A resident with no
 * passkey or no Safe is refused honestly rather than having anything
 * fabricated. This mirrors the Invest flow's `resolveDepositContext`.
 */
async function resolveOperatorContext(): Promise<OperatorContext> {
  const session = await getSessionUser();
  if (!session) {
    return { ok: false, reason: 'You must be signed in to withdraw.' };
  }

  const stored = await loadPasskeyCredential();
  if (!stored?.publicKey || !stored.credentialId) {
    return {
      ok: false,
      reason:
        'No transaction passkey is stored for this account, so the withdrawal ' +
        'cannot be authorised.',
    };
  }

  const shellSafe = await loadShellSafe(session.userId);
  if (!shellSafe.address) {
    return {
      ok: false,
      reason:
        'No Safe is recorded for this account yet, so there is nothing to ' +
        'withdraw.',
    };
  }

  try {
    const { x, y } = parseP256PublicKey(stored.publicKey);
    const signer = toPasskeySigner({
      rawId: stored.credentialId,
      coordinates: { x: x.toString(), y: y.toString() },
    });
    return {
      ok: true,
      signer,
      safeAddress: shellSafe.address as Address,
      // `signer.rawId` is the credential id's bytes as hex — the form Safe's
      // SDK and the browser prompt both expect. The stored id is base64url.
      credentialId: signer.rawId,
    };
  } catch (cause) {
    console.warn(
      '[kade] resolving the operator-withdraw signer failed:',
      cause instanceof Error ? cause.message : cause,
    );
    return {
      ok: false,
      reason: 'The stored passkey could not be used to authorise the withdrawal.',
    };
  }
}

/**
 * The Safe's state on the **withdrawal chain**, verified against the record.
 *
 * The recorded Safe is Sepolia-scoped, but the withdrawal executes on the named
 * vault chain (Ethereum mainnet, Base or Arbitrum One). Safe's contracts live at
 * the same address on every chain and the address was derived from the passkey,
 * so the same address is expected there — counterfactual until its first user
 * operation deploys it. This re-derives the account on the withdrawal chain
 * rather than assuming the record's deployment state.
 *
 * It is deliberately fail-closed: the derived address must equal the address the
 * calls target (the recorded one) before anything is built or signed. This
 * mirrors the Invest flow's `resolveDepositSafe`.
 */
type OperatorSafe =
  | {
      readonly ok: true;
      /**
       * What `Safe4337Pack.init` is given: the verified existing address when
       * the Safe is deployed on the withdrawal chain, or `null` so its first
       * sponsored user operation deploys the predicted Safe.
       */
      readonly packSafeAddress: Address | null;
    }
  | { readonly ok: false; readonly gate: string; readonly reason: string };

async function resolveOperatorSafe(
  signer: PasskeySigner,
  recorded: Address,
  chainId: number,
): Promise<OperatorSafe> {
  let derived: DerivedAccount;
  try {
    derived = await deriveAccountFromPasskey(signer, { chainId });
  } catch (cause) {
    return {
      ok: false,
      gate: 'safe-not-resolved',
      reason:
        'The Safe could not be resolved on the withdrawal chain, so nothing was ' +
        `built or sent (${cause instanceof Error ? cause.message : String(cause)}).`,
    };
  }

  if (derived.safeAddress.toLowerCase() !== recorded.toLowerCase()) {
    return {
      ok: false,
      gate: 'safe-not-verified',
      reason:
        'The Safe derived from this account on the withdrawal chain is not the ' +
        'Safe recorded for it, so nothing was built or sent.',
    };
  }

  return {
    ok: true,
    packSafeAddress: derived.deployed ? derived.safeAddress : null,
  };
}

/** Whether the chain is one of the supported vault chains. */
function isSupportedWithdrawChain(chainId: number): boolean {
  return (MORPHO_VAULT_CHAIN_IDS as readonly number[]).includes(chainId);
}

/** The human chain name, or a stable fallback. */
function chainNameOf(chainId: number): string {
  return chainByChainId(chainId)?.name ?? `chain ${chainId}`;
}

/** The token's human label, for a refusal that names what could not be moved. */
function tokenLabel(token: OperatorWithdrawToken): string {
  return token === 'native' ? 'native coin' : 'USDC';
}

/** The token's decimals. */
function tokenDecimals(token: OperatorWithdrawToken): number {
  return token === 'native' ? NATIVE_DECIMALS : USDC_DECIMALS;
}

/**
 * Normalise a destination address, or null when it is not a valid EVM address.
 * `getAddress` rejects a wrong-length value and a bad EIP-55 checksum, so a
 * mistyped mixed-case address is refused rather than normalised silently.
 */
function normalizeDestination(value: string): Address | null {
  try {
    return getAddress(value.trim());
  } catch {
    return null;
  }
}

/**
 * Parse a positive base-unit integer amount, or null. The amount is the raw
 * token amount (USDC's 6-decimal units or wei), not a decimal string, so the
 * client resolves the decimals and the server validates the integer alone.
 */
function parseAmountUnits(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const units = BigInt(trimmed);
  return units > 0n ? units : null;
}

/** The honest refusal when the environment flag is off. */
function disabledReason(): string {
  return (
    `Operator withdrawal is disabled. Set ${OPERATOR_WITHDRAW_ENV}=1 to ` +
    'enable it.'
  );
}

/**
 * Phase 1 — build the withdrawal and return the hash the passkey must sign.
 *
 * This **signs nothing**. It resolves the resident, their stored credential and
 * their recorded Safe, validates the destination, amount and chain server-side,
 * pre-flights the Safe's balance for the named token, builds the single transfer
 * call and retains the operation. It returns only
 * `{ token, hash, credentialId, chainId }`.
 *
 * No gate flag is taken from the caller: the environment flag, the chain
 * allow-list and the balance are all resolved here, so a client cannot turn a
 * gate off or overdraw the Safe.
 */
export async function beginOperatorWithdraw(input: {
  readonly safeAddress: string;
  readonly chainId: number;
  readonly token: OperatorWithdrawToken;
  readonly destination: string;
  readonly amount: string;
}): Promise<BuildOperatorWithdrawResult> {
  if (!isOperatorWithdrawEnabled()) {
    return { status: 'gated', gate: 'disabled', reason: disabledReason() };
  }

  const context = await resolveOperatorContext();
  if (!context.ok) {
    return { status: 'gated', gate: 'not-authenticated', reason: context.reason };
  }

  // The server's recorded Safe is authoritative. A mismatch means the caller is
  // trying to withdraw from a Safe they do not own, so it is refused.
  if (context.safeAddress.toLowerCase() !== input.safeAddress.toLowerCase()) {
    return {
      status: 'gated',
      gate: 'safe-mismatch',
      reason:
        'The Safe named for the withdrawal is not the Safe recorded for this ' +
        'account, so nothing was built.',
    };
  }

  if (!isSupportedWithdrawChain(input.chainId)) {
    return {
      status: 'gated',
      gate: 'chain-not-supported',
      reason:
        `Chain ${input.chainId} is not a supported withdrawal chain. ` +
        'Withdrawals run on Ethereum mainnet, Base or Arbitrum One, so nothing ' +
        'was built.',
    };
  }

  const destination = normalizeDestination(input.destination);
  if (destination === null) {
    return {
      status: 'gated',
      gate: 'invalid-destination',
      reason:
        `"${input.destination}" is not a valid address, so nothing was built.`,
    };
  }
  if (destination.toLowerCase() === ZERO_ADDRESS) {
    return {
      status: 'gated',
      gate: 'invalid-destination',
      reason: 'The destination is the zero address, so nothing was built.',
    };
  }
  if (destination.toLowerCase() === context.safeAddress.toLowerCase()) {
    return {
      status: 'gated',
      gate: 'invalid-destination',
      reason:
        'The destination is the Safe itself, so there is nothing to move.',
    };
  }

  const amountUnits = parseAmountUnits(input.amount);
  if (amountUnits === null) {
    return {
      status: 'gated',
      gate: 'invalid-amount',
      reason:
        "The amount must be a positive integer in the token's smallest unit, " +
        'so nothing was built.',
    };
  }

  // Balance pre-flight: the Safe must hold the token it is being asked to move.
  // A failed read refuses rather than passing; an over-balance amount is refused
  // with the held and needed amounts named.
  const balance = await readSafeTokenBalance({
    safeAddress: context.safeAddress,
    chainId: input.chainId,
    token: input.token,
  });
  if (balance.status === 'failed') {
    return {
      status: 'gated',
      gate: 'balance-unreadable',
      reason:
        `The Safe's ${tokenLabel(input.token)} balance on ` +
        `${chainNameOf(input.chainId)} could not be read, so nothing was ` +
        `built: ${balance.reason}.`,
    };
  }
  if (amountUnits > balance.balance) {
    const decimals = tokenDecimals(input.token);
    return {
      status: 'gated',
      gate: 'insufficient-balance',
      reason:
        `The Safe holds ${formatUnits(balance.balance, decimals)} ` +
        `${tokenLabel(input.token)} on ${chainNameOf(input.chainId)}, but the ` +
        `withdrawal asks for ${formatUnits(amountUnits, decimals)}. Nothing ` +
        'was built.',
    };
  }

  const safe = await resolveOperatorSafe(
    context.signer,
    context.safeAddress,
    input.chainId,
  );
  if (!safe.ok) {
    return { status: 'gated', gate: safe.gate, reason: safe.reason };
  }

  // ONE call: an ERC-20 `transfer` for USDC, or a plain value transfer for the
  // native coin. Nothing else is batched.
  let call: SafeCall;
  if (input.token === 'native') {
    call = { to: destination, value: amountUnits, data: '0x' };
  } else {
    const usdc = usdcAddressForChain(input.chainId);
    if (!usdc) {
      return {
        status: 'gated',
        gate: 'token-not-configured',
        reason:
          `No USDC contract is configured for chain ${input.chainId}, so ` +
          'nothing was built.',
      };
    }
    call = {
      to: usdc as Address,
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [destination, amountUnits],
      }),
    };
  }

  const built = await buildResidentSafeBatchFromEnv({
    signer: context.signer,
    safeAddress: safe.packSafeAddress,
    calls: [call],
    chainId: input.chainId,
  });

  if (built.status === 'built') {
    return {
      status: 'ready',
      token: built.token,
      hash: built.hash,
      credentialId: context.credentialId,
      chainId: input.chainId,
    };
  }

  if (built.status === 'failed') {
    return {
      status: 'gated',
      gate: `build-${built.stage}`,
      reason: built.reason,
    };
  }

  return {
    status: 'gated',
    gate:
      built.status === 'not-configured' ? 'sponsor-not-configured' : 'build-empty',
    reason:
      built.status === 'not-configured'
        ? built.reason
        : 'No call was built for the withdrawal, so there is nothing to sign.',
  };
}

/**
 * Phase 2 — attach the browser's assertion to the retained operation and submit.
 *
 * The client supplies only `{ token, assertion, chainId }`. The signer and the
 * Safe are resolved server-side, exactly as in `beginOperatorWithdraw`, and the
 * chain is validated against the pinned vault-chain registry, so a chain with
 * no rail is refused rather than submitted on a default network. The outcome is
 * returned verbatim: a `sent` result appears only for a confirmed receipt, and
 * every refusal names its stage.
 */
export async function completeOperatorWithdraw(input: {
  readonly token: string;
  readonly assertion: SafeAssertionParts;
  readonly chainId: number;
}): Promise<CompleteOperatorWithdrawResult> {
  if (!isOperatorWithdrawEnabled()) {
    return {
      status: 'failed',
      sent: false,
      stage: 'resolve',
      reason: disabledReason(),
    };
  }

  const context = await resolveOperatorContext();
  if (!context.ok) {
    return {
      status: 'failed',
      sent: false,
      stage: 'resolve',
      reason: context.reason,
    };
  }

  if (!isSupportedWithdrawChain(input.chainId)) {
    return {
      status: 'failed',
      sent: false,
      stage: 'resolve',
      reason:
        `Chain ${input.chainId} is not a supported withdrawal chain, so ` +
        'nothing was submitted.',
    };
  }

  const safe = await resolveOperatorSafe(
    context.signer,
    context.safeAddress,
    input.chainId,
  );
  if (!safe.ok) {
    return {
      status: 'failed',
      sent: false,
      stage: 'resolve',
      reason: safe.reason,
    };
  }

  return submitResidentSafeOperationFromEnv({
    token: input.token,
    assertion: input.assertion,
    signer: context.signer,
    safeAddress: safe.packSafeAddress,
    chainId: input.chainId,
  });
}
