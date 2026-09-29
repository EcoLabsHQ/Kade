'use client';

import { useEffect, useRef, useState } from 'react';
import { savePasskeyCredential } from '@/app/account/passkey-actions';
import { Card } from '@/components/ui/Card';
import { tokens } from '@/components/ui/tokens';
import type { SignerPersistence } from '@/lib/passkey/credential';

/**
 * Step 1 — create the transaction passkey, and derive the account from it.
 *
 * The passkey is created through WebAuthn with user verification, in the
 * authenticator, and authorises Safe transactions. It is not a login method and
 * it is not the session (contract section 2 item 3, ADR 0003), which is why the
 * sign-in screen never asks for it.
 *
 * The address shown afterwards is the resident's account: the Safe the passkey
 * will own. It is derived from the credential's public key plus inputs frozen in
 * `@kade/shared`, so it is the same address every time and different for every
 * resident. It is counterfactual until the Safe is deployed, which is the ordinary
 * state of a Safe before its first transaction.
 */
export interface AccountSetupStepProps {
  readonly rpId: string;
  readonly userId: string;
  readonly userName: string;
  readonly credentialId: string | null;
  readonly onEnrolled: (credentialId: string) => void;
  readonly onContinue: () => void;
}

/** What is known about the account address once the passkey exists. */
type AccountAddress =
  | { readonly state: 'idle' }
  | { readonly state: 'deriving' }
  | { readonly state: 'ready'; readonly value: string; readonly deployed: boolean }
  | { readonly state: 'failed'; readonly reason: string }
  | { readonly state: 'unavailable' };

/**
 * Whether the account itself exists on chain yet.
 *
 * The failure case keeps the specific status rather than collapsing every
 * non-success into one state, so the screen can say something true and offer a
 * retry. The status is product language at this boundary; the technical reason
 * stays in the server log.
 */
type DeployFailureStatus =
  | 'not-configured'
  | 'insufficient-funds'
  | 'address-mismatch'
  | 'failed'
  | 'unavailable';

type DeployState =
  | { readonly state: 'idle' }
  | { readonly state: 'deploying' }
  /** Deployed, or already there. */
  | { readonly state: 'ready' }
  /** The passkey is real but the account is not on chain yet. */
  | { readonly state: 'failed'; readonly status: DeployFailureStatus };

/** A 32-byte challenge. [arbitrary] client-side: a production flow issues it server-side. */
function randomChallenge(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function AccountSetupStep({
  rpId,
  userId,
  userName,
  credentialId,
  onEnrolled,
  onContinue,
}: AccountSetupStepProps) {
  const [status, setStatus] = useState<'idle' | 'creating' | 'done' | 'error'>(
    credentialId ? 'done' : 'idle',
  );
  const [account, setAccount] = useState<AccountAddress>({ state: 'idle' });
  const [signer, setSigner] = useState<SignerPersistence | null>(null);
  const [deploy, setDeploy] = useState<DeployState>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);

  /**
   * Which credential has already been through `recordAccount`.
   *
   * The create path and the mount effect both ask for the address; without this
   * the same credential would be derived twice, which is a wasted round trip
   * and two racing writes of the same row. A ref, not state: it guards work, it
   * is not rendered.
   */
  const derivedFor = useRef<string | null>(null);

  /**
   * Record the account address Safe's SDK derives from the passkey.
   *
   * Nothing is deployed: the account is an address until its first operation.
   * The result is kept so the screen can say what happened — a silent failure
   * would leave the resident with no account and no explanation.
   *
   * `forCredential` names the credential being recorded. The create path knows
   * it from the enrolment it just persisted; the effect takes it from the prop.
   * Passing it in, rather than reading the prop, is what makes the guard below
   * work: `onEnrolled` updates the prop before the effect can run, so a guard
   * that read the prop would see a different value and derive a second time.
   */
  async function recordAccount(forCredential: string | null) {
    // One attempt per credential, however many callers reach here: the create
    // path invokes it directly and the effect below invokes it on mount, and
    // both legitimately want an account. Deriving twice would be a second round
    // trip to the chain for the same answer, and the second write would race
    // the first.
    if (!forCredential) return;
    if (derivedFor.current === forCredential) return;
    derivedFor.current = forCredential;
    // Deriving an address means a round trip to the chain through Safe's SDK,
    // so it is not instant. Saying so is the difference between "working" and
    // "broken": without this the address line shows a dash for seconds.
    setAccount({ state: 'deriving' });
    try {
      const { deriveAndRecordAccount } = await import(
        '@/app/onboarding/account-actions'
      );
      const outcome = await deriveAndRecordAccount();
      if (
        outcome.status === 'recorded' ||
        outcome.status === 'refreshed' ||
        outcome.status === 'already-recorded'
      ) {
        setAccount({
          state: 'ready',
          value: outcome.safeAddress ?? '',
          deployed: outcome.deployed,
        });
        return;
      }
      // A derivation that did not happen is reported, never swallowed: without
      // it the resident has no account, and that must not look like success.
      setAccount({
        state: 'failed',
        reason:
          outcome.status === 'unavailable'
            ? 'Your passkey is ready. Sign in again to finish your account.'
            : 'Your account address could not be set up yet.',
      });
    } catch (cause) {
      setAccount({
        state: 'failed',
        reason:
          cause instanceof Error
            ? cause.message
            : 'Your account address could not be set up yet.',
      });
    }
  }

  /**
   * Finish an account that was left without one.
   *
   * A resident whose passkey predates this step — or whose derivation failed
   * once — would otherwise stay broken forever, because the recording used to
   * run only on a fresh enrolment. Running it whenever the step mounts with a
   * credential already present closes that gap: the row is written as soon as
   * the resident opens the step again, and an existing row is left alone.
   *
   * Keyed on the credential, not on the account state: `recordAccount` writes
   * the state itself, so depending on it would re-enter this effect after every
   * failure and hammer the chain. One credential, one derivation attempt.
   */
  useEffect(() => {
    if (status !== 'done') return;
    void recordAccount(credentialId);
  }, [status, credentialId]);

  async function createPasskey() {
    setStatus('creating');
    setError(null);
    setSigner(null);
    try {
      const { enrolPasskey } = await import('@/lib/passkey/enrolment');
      const record = await enrolPasskey(
        {
          domain: 'application-session',
          provider: 'email',
          userId,
          email: userName,
        },
        {
          rpId,
          rpName: 'Onchain Island',
          userId,
          userName,
          challenge: randomChallenge(),
        },
      );

      // D3: only a user-verified credential may be persisted. The real
      // enrolment asserts this too, but keeping the guard here makes the
      // call-site invariant explicit and testable.
      if (record.userVerification !== true) {
        throw new Error(
          'The passkey did not require user verification, so it was not saved.',
        );
      }

      // Persist through the existing server action so the credential survives
      // reload. The action derives the signer from the public key; the browser
      // names none. The account address is then read from that stored
      // credential by `recordAccount`, below, so one credential yields one
      // address.
      let credentialIdToReport = record.credentialId;
      try {
        const saved = await savePasskeyCredential({
          credentialId: record.credentialId,
          publicKey: record.publicKey,
          transports: record.transports,
          userVerification: record.userVerification,
        });
        setSigner(saved.signer);
        credentialIdToReport = saved.credential.credentialId;
      } catch (cause) {
        // The passkey exists on the device even when the server write fails,
        // so the resident is not blocked. The screen simply must not claim the
        // credential was stored.
        setSigner({
          status: 'not-persisted',
          reason:
            cause instanceof Error
              ? cause.message
              : 'The passkey could not be saved.',
        });
      }

      // The passkey is real as soon as the credential is persisted, so the
      // screen says so immediately. The address comes from Safe's SDK and is
      // recorded next, which is why the address line — not this line — carries
      // the pending state.
      setStatus('done');
      // Recorded with the credential just saved, before `onEnrolled` reports
      // it: `recordAccount` claims that credential, so when the prop updates
      // and the mount effect runs, it finds the work already done instead of
      // deriving the same address a second time.
      await recordAccount(credentialIdToReport);
      onEnrolled(credentialIdToReport);
      // Nothing else to deploy. Under Safe's passkey model the passkey **is**
      // the Safe's owner and the account is deployed by its first user
      // operation, so there is no signer contract and no separate deployment
      // step. The account becomes a contract with its first operation, which
      // the paymaster sponsors.
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The passkey could not be created. Please try again.',
      );
      setStatus('error');
    }
  }

  const enrolled = status === 'done';

  return (
    <div style={{ animation: 'fadeUp .2s ease-out' }}>
      <div style={eyebrow}>Step 1 of 4</div>
      <h1 style={heading}>Create your account</h1>
      <p style={lead}>
        Your passkey authorises transactions on your Safe. It stays on this
        device — there is nothing to remember and nothing to type.
      </p>

      <Card padding="22px 24px" style={{ maxWidth: '560px' }}>
        {enrolled ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <CheckMark />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>
                Passkey created
              </div>
              <div style={{ fontSize: '13px', color: tokens.muted, marginTop: '2px' }}>
                {signer?.status === 'not-persisted'
                  ? "Your passkey is on this device. We'll link it to your account shortly."
                  : 'Your passkey is ready. It becomes your account owner.'}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: '15px', fontWeight: 600 }}>
              Create a passkey
            </div>
            <div
              style={{
                fontSize: '13px',
                color: tokens.muted,
                marginTop: '4px',
                lineHeight: 1.6,
              }}
            >
              Your device will ask for your fingerprint, face or PIN.
            </div>
            <button
              type="button"
              onClick={() => void createPasskey()}
              disabled={status === 'creating'}
              style={{
                ...primaryButton,
                marginTop: '16px',
                background: status === 'creating' ? tokens.locked : tokens.action,
                cursor: status === 'creating' ? 'wait' : 'pointer',
              }}
            >
              {status === 'creating' ? 'Waiting for your device…' : 'Create passkey'}
            </button>
          </>
        )}

        {enrolled ? (
          <div
            style={{
              marginTop: '18px',
              paddingTop: '14px',
              borderTop: `1px solid ${tokens.border}`,
            }}
          >
            <div style={{ fontSize: '12px', color: tokens.muted }}>
              Your account address
            </div>
            <div
              style={{
                marginTop: '4px',
                fontSize: '13px',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
                wordBreak: 'break-all',
              }}
            >
              <AccountAddressLine account={account} />
            </div>
            <div
              style={{
                marginTop: '6px',
                fontSize: '12px',
                color: tokens.muted,
              }}
            >
            </div>
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            style={{ margin: '12px 0 0', fontSize: '12.5px', color: tokens.danger }}
          >
            {error}
          </p>
        ) : null}
      </Card>

      <div style={{ marginTop: '24px' }}>
        <button
          type="button"
          disabled={!enrolled}
          onClick={onContinue}
          style={{
            ...primaryButton,
            background: enrolled ? tokens.action : tokens.locked,
            cursor: enrolled ? 'pointer' : 'not-allowed',
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function AccountAddressLine({ account }: { readonly account: AccountAddress }) {
  if (account.state === 'ready') return <>{account.value}</>;
  if (account.state === 'deriving') {
    return <span style={{ color: tokens.muted, fontWeight: 500 }}>Preparing…</span>;
  }
  if (account.state === 'failed') {
    // A derivation that did not happen is shown, not hidden behind a dash: the
    // resident has no account, and that must not read as "still coming".
    return (
      <span style={{ color: tokens.danger, fontWeight: 500 }}>{account.reason}</span>
    );
  }
  if (account.state === 'unavailable') {
    return (
      <span style={{ color: tokens.muted, fontWeight: 500 }}>
        Will appear once your account is set up.
      </span>
    );
  }
  return <span style={{ color: tokens.muted, fontWeight: 500 }}>—</span>;
}

/**
 * The resident-facing explanation for a deployment that did not complete.
 *
 * Each mode is distinct so the resident is not told "shortly" when the truth is
 * "the network fee could not be covered". None of these name configuration.
 */
const DEPLOY_FAILURE_MESSAGE: Readonly<Record<DeployFailureStatus, string>> = {
  'not-configured': 'We are still preparing account setup. Please try again.',
  'insufficient-funds': 'We could not cover the network fee for setup. Please try again.',
  'address-mismatch': 'We paused for a safety check. Please try again.',
  failed: 'We could not finish setting up your account. Please try again.',
  unavailable: 'We could not reach the network to finish setup. Please try again.',
};

function DeployLine({
  deploy,
  onRetry,
}: {
  readonly deploy: DeployState;
  readonly onRetry: () => void;
}) {
  if (deploy.state === 'deploying') return <>Setting up your account…</>;
  if (deploy.state === 'ready') {
    return <>Your account is live on Sepolia.</>;
  }
  if (deploy.state === 'failed') {
    // Honest: the passkey is theirs and the address is theirs, but the contract
    // is not on chain. Say which failure it was and let them try again — the
    // address is deterministic, so a retry cannot create a second account.
    return (
      <span>
        {DEPLOY_FAILURE_MESSAGE[deploy.status]}{' '}
        <button type="button" onClick={onRetry} style={retryButton}>
          Try again
        </button>
      </span>
    );
  }
  return null;
}

function CheckMark() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        width: '26px',
        height: '26px',
        borderRadius: '50%',
        background: '#EAF6F0',
        color: tokens.success,
      }}
    >
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path
          d="M2.5 6.8 5.2 9.5 10.5 3.8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

const eyebrow: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const heading: React.CSSProperties = {
  margin: '8px 0 6px',
  fontSize: '30px',
  fontWeight: 700,
  letterSpacing: '-.02em',
};

const lead: React.CSSProperties = {
  margin: '0 0 24px',
  color: tokens.muted,
  maxWidth: '62ch',
  textWrap: 'pretty',
};

const primaryButton: React.CSSProperties = {
  height: '46px',
  padding: '0 22px',
  border: 0,
  borderRadius: '999px',
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
};

const retryButton: React.CSSProperties = {
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  color: tokens.ink,
  fontFamily: 'inherit',
  fontSize: '12px',
  fontWeight: 600,
  padding: '3px 10px',
  cursor: 'pointer',
};
