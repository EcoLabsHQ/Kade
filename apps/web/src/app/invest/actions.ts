'use server';

import type { Address } from 'viem';
import { getSessionUser } from '@/lib/supabase/server';
import { loadPasskeyCredential } from '@/app/account/passkey-actions';
import { parseP256PublicKey } from '@/lib/passkey/public-key';
import { toPasskeySigner, type PasskeySigner } from '@/lib/safe/passkey-signer';
import { loadShellSafe } from '@/lib/safe/shell';
import { prepareMorphoVaultDeposit } from '@/lib/invest/morpho-execution';
import { morphoChainId } from '@/lib/invest/morpho-config';
import {
  buildResidentSafeBatchFromEnv,
  submitResidentSafeOperationFromEnv,
} from '@/lib/safe/execute-safe-4337-env';
import type {
  SafeAssertionParts,
  SafeSubmitOutcome,
} from '@/lib/safe/execute-safe-4337';

/**
 * The Invest server actions (D18 / EXE-014), in two phases.
 *
 * The browser never holds the vault address, its underlying USDC, the Pimlico
 * key or the calldata builder's inputs. It also never holds the operation: the
 * passkey assertion is browser-only (`navigator.credentials.get`) while the
 * sponsored bundler is a server secret, so building and signing cannot happen in
 * one server call. The flow is therefore split:
 *
 *   1. `beginDeposit` — server, no signing. Resolves the resident, their stored
 *      credential and their recorded Safe, builds the Morpho calls, and retains
 *      the Safe operation server-side. Returns only `{ token, hash,
 *      credentialId }`, where `hash` is the SafeOp EIP-712 hash the passkey must
 *      sign.
 *   2. `completeDeposit` — server, after the browser signs. Takes only
 *      `{ token, assertion }`, resolves the same signer and Safe, and submits
 *      the retained operation. Nothing here is trusted from the client except
 *      the three raw WebAuthn assertion pieces.
 *
 * The signer is built server-side from the **stored credential** — never named
 * by the caller — and without a `getFn`: the browser supplies the assertion,
 * which is the entire point of the split.
 */

/** A serialisable summary of the resolved vault, for the page to render. */
export interface InvestVaultSummary {
  readonly configured: boolean;
  readonly chainId: number;
  readonly chainName: string;
  /** The MetaMorpho vault, when configured. */
  readonly vault: string | null;
  /** The vault's underlying USDC, when configured. */
  readonly usdc: string | null;
}

/** What the client receives when it asks to build (not send) a deposit. */
export type BuildDepositResult =
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
      /**
       * The credential id in the hex form Safe and the WebAuthn prompt use, so
       * the browser can select it in `allowCredentials`. Not a secret.
       */
      readonly credentialId: string;
    };

/**
 * What the client receives when it submits the signed operation.
 *
 * The success variant exists only for a **confirmed receipt**; every refusal is
 * a `failed` outcome that names the stage it stopped at, so a built or submitted
 * operation can never be mistaken for a deposit.
 */
export type CompleteDepositResult =
  | SafeSubmitOutcome
  | {
      readonly status: 'failed';
      readonly sent: false;
      /** The refusal happened before the engine, resolving the signer/Safe. */
      readonly stage: 'resolve';
      readonly reason: string;
    };

/** The server-held facts a deposit needs, resolved from the session. */
type DepositContext =
  | {
      readonly ok: true;
      readonly signer: PasskeySigner;
      readonly safeAddress: Address;
      /** Safe's hex credential id, for the browser's `allowCredentials`. */
      readonly credentialId: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolve the signed-in resident's deposit context from server-held state.
 *
 * The signer comes from the **stored credential** and the Safe from the
 * deployment record — neither is named by the caller. Both phases resolve it
 * this way, so the operation a resident signs always belongs to the Safe they
 * hold, and a caller cannot have a deposit built for an address they do not
 * own. A resident with no passkey or no Safe is refused honestly rather than
 * having anything fabricated.
 */
async function resolveDepositContext(): Promise<DepositContext> {
  const session = await getSessionUser();
  if (!session) {
    return { ok: false, reason: 'You must be signed in to allocate.' };
  }

  const stored = await loadPasskeyCredential();
  if (!stored?.publicKey || !stored.credentialId) {
    return {
      ok: false,
      reason:
        'No transaction passkey is stored for this account. Create one before ' +
        'allocating.',
    };
  }

  const shellSafe = await loadShellSafe(session.userId);
  if (!shellSafe.address) {
    return {
      ok: false,
      reason:
        'No Safe is recorded for this account yet, so there is nothing to ' +
        'allocate from.',
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
    // Surfaced in the log, never presented as if the signer were usable.
    console.warn(
      '[kade] resolving the deposit signer failed:',
      cause instanceof Error ? cause.message : cause,
    );
    return {
      ok: false,
      reason: 'The stored passkey could not be used to authorise the deposit.',
    };
  }
}

/**
 * Phase 1 — build the deposit and return the hash the passkey must sign.
 *
 * This **signs nothing**: it builds the plan and the user operation, retains the
 * operation server-side and returns `{ token, hash, credentialId }`. Gate state
 * is passed in by the page (which resolves the vault and the environment);
 * everything the resident could not be trusted to name is resolved here.
 */
export async function beginDeposit(input: {
  readonly safeAddress: string;
  readonly amountUsdc: string;
  readonly vaultConfigured: boolean;
  readonly mainnetConfigured: boolean;
}): Promise<BuildDepositResult> {
  const context = await resolveDepositContext();
  if (!context.ok) {
    return { status: 'gated', gate: 'not-authenticated', reason: context.reason };
  }

  // The server's recorded Safe is authoritative. The address the client named
  // comes from the same record; a mismatch means the caller is trying to have
  // the deposit built for a Safe they do not own, so it is refused.
  if (context.safeAddress.toLowerCase() !== input.safeAddress.toLowerCase()) {
    return {
      status: 'gated',
      gate: 'safe-mismatch',
      reason:
        'The Safe named for the deposit is not the Safe recorded for this ' +
        'account, so nothing was built.',
    };
  }

  const result = await prepareMorphoVaultDeposit(
    { safeAddress: context.safeAddress, amountUsdc: input.amountUsdc },
    { mainnetConfigured: input.mainnetConfigured },
  );

  if (result.status === 'gated') {
    return { status: 'gated', gate: result.gate, reason: result.reason };
  }

  const plan = result.plan;
  const built = await buildResidentSafeBatchFromEnv({
    signer: context.signer,
    safeAddress: context.safeAddress,
    calls: plan.calls,
    // The vault's own chain (mainnet), not a value the client supplied.
    chainId: plan.chainId,
  });

  if (built.status === 'built') {
    return {
      status: 'ready',
      token: built.token,
      hash: built.hash,
      credentialId: context.credentialId,
    };
  }

  if (built.status === 'failed') {
    return {
      status: 'gated',
      gate: `build-${built.stage}`,
      reason: built.reason,
    };
  }

  // `not-configured` (the sponsored bundler is absent) and the defensive
  // `ready` (no calls) can never be presented as a built operation.
  return {
    status: 'gated',
    gate: built.status === 'not-configured' ? 'sponsor-not-configured' : 'build-empty',
    reason:
      built.status === 'not-configured'
        ? built.reason
        : 'No calls were built for the deposit, so there is nothing to sign.',
  };
}

/**
 * Phase 2 — attach the browser's assertion to the retained operation and submit.
 *
 * The client supplies only `{ token, assertion }`. The signer and the Safe are
 * resolved server-side, exactly as in `beginDeposit`, so the operation is always
 * submitted from the resident's own Safe. The outcome is returned verbatim: a
 * `sent` result appears only for a confirmed receipt, and every refusal names
 * its stage.
 */
export async function completeDeposit(input: {
  readonly token: string;
  readonly assertion: SafeAssertionParts;
}): Promise<CompleteDepositResult> {
  const context = await resolveDepositContext();
  if (!context.ok) {
    return { status: 'failed', sent: false, stage: 'resolve', reason: context.reason };
  }

  return submitResidentSafeOperationFromEnv({
    token: input.token,
    assertion: input.assertion,
    signer: context.signer,
    safeAddress: context.safeAddress,
    chainId: morphoChainId(),
  });
}
