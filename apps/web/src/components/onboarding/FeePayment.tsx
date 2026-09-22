'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useAppKit,
  useAppKitAccount,
  useAppKitNetwork,
} from '@reown/appkit/react';
import { sepolia } from '@reown/appkit/networks';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { parseUnits, type Hex } from 'viem';
import { recordPreapprovalFeePayment } from '@/app/onboarding/payment-actions';
import type { RecordFeeResult } from '@/lib/payments/preapproval-fee';
import { tokens } from '@/components/ui/tokens';

/**
 * The connect-and-pay control for the pre-approval fee (contract 8.9).
 *
 * The resident connects a browser wallet or WalletConnect, switches to
 * Ethereum Sepolia and sends the fee as a direct USDC transfer to the Kade
 * treasury. The browser only sends; the server independently verifies the
 * `transfer` receipt before the step is marked paid, so nothing here can assert
 * a payment that did not happen.
 *
 * The amount, the treasury and the token are all supplied by the server. This
 * component holds no fee value and no recipient default.
 */

const USDC_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export interface FeePaymentProps {
  /** The server-resolved fee, as a whole-USDC decimal string. */
  readonly amountUsdc: string;
  /** The Kade treasury, resolved on the server. */
  readonly treasuryAddress: `0x${string}`;
  /** USDC on Ethereum Sepolia, from `@kade/shared` chain configuration. */
  readonly usdcAddress: `0x${string}`;
  readonly explorerUrl: string;
  readonly onPaid: (txHash: Hex) => void;
  /** Closes the host modal; shown next to the receipt on completion. */
  readonly onClose?: () => void;
}

function messageFor(result: RecordFeeResult): string {
  switch (result.status) {
    case 'underpaid':
      return `That payment was ${result.receivedUsdc} USDC but the fee is ${result.requiredUsdc} USDC.`;
    case 'no-transfer':
      return 'We could not find a USDC transfer to the Kade treasury in that transaction.';
    case 'wrong-sender':
      return 'That payment was sent from a different wallet than the one connected. Connect the wallet that paid and check again.';
    case 'failed':
      return 'That transaction failed on chain, so nothing was paid.';
    case 'pending':
      return 'We cannot see the payment on chain yet. It may still be confirming.';
    case 'not-configured':
      return 'Payment is not configured in this environment.';
    case 'invalid-hash':
      return 'That transaction reference is not valid.';
    case 'no-application':
      return 'Save your profile before paying the fee.';
    case 'unauthenticated':
      return 'Your session expired. Sign in again to pay the fee.';
    case 'error':
      return 'We could not confirm the payment. Please try again.';
    case 'paid':
      return '';
  }
}

type ServerState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'verifying' }
  | {
      readonly kind: 'error';
      readonly message: string;
      /** A re-check can resolve it (still confirming). */
      readonly canRecheck: boolean;
      /** A fresh transfer can resolve it (underpaid, failed, no transfer). */
      readonly canRetryPayment: boolean;
    };

/**
 * Which recovery a failed verification offers.
 *
 * `pending` is deliberately absent: a payment that is still confirming is not
 * a failure, so it never reaches this and never offers a re-check. It stays on
 * the loader until the receipt is mined.
 */
function recoveryFor(status: RecordFeeResult['status']): {
  readonly canRecheck: boolean;
  readonly canRetryPayment: boolean;
} {
  switch (status) {
    case 'underpaid':
    case 'failed':
    case 'no-transfer':
      return { canRecheck: false, canRetryPayment: true };
    default:
      // not-configured, no-application, unauthenticated, invalid-hash, error:
      // neither a re-check nor a second transfer can fix these.
      return { canRecheck: false, canRetryPayment: false };
  }
}

/** How long a verification may run before the resident is offered a re-check. */
const VERIFY_TIMEOUT_MS = 15_000;

/** How often a still-confirming payment is re-checked without user action. */
const PENDING_POLL_MS = 4_000;

/**
 * Race a server verification against a deadline.
 *
 * The underlying request is not cancelled, but the screen stops waiting on it
 * and falls back to an explicit re-check, so a slow or wedged verification can
 * never leave the resident on "Confirming…" forever.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('verification timed out')),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * The pending-fee hash has to outlive the deposit modal that hosts this
 * component. `Modal` unmounts its children when it closes, which destroys both
 * wagmi's local hash and the receipt watcher, so the hash is mirrored into
 * `sessionStorage` and re-verified whenever the component mounts again.
 *
 * The key names the treasury, so a hash recorded against one deposit address is
 * never resumed against another. Every read is defensive: `sessionStorage` can
 * throw (private mode) or hold junk, and either way the component starts idle.
 */
const PENDING_TX_PREFIX = 'kade:preapproval-fee:pending-tx:';

function pendingTxKey(treasuryAddress: string): string {
  return `${PENDING_TX_PREFIX}${treasuryAddress.toLowerCase()}`;
}

function readPendingHash(treasuryAddress: string): Hex | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(pendingTxKey(treasuryAddress));
    return raw && /^0x[0-9a-fA-F]{64}$/.test(raw) ? (raw as Hex) : null;
  } catch {
    return null;
  }
}

function writePendingHash(treasuryAddress: string, hash: Hex): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(pendingTxKey(treasuryAddress), hash);
  } catch {
    // Private mode or a full store: this mount still holds the hash in memory.
  }
}

function clearPendingHash(treasuryAddress: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(pendingTxKey(treasuryAddress));
  } catch {
    // Nothing to clear.
  }
}

export function FeePayment({
  amountUsdc,
  treasuryAddress,
  usdcAddress,
  explorerUrl,
  onPaid,
  onClose,
}: FeePaymentProps) {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { chainId, switchNetwork } = useAppKitNetwork();
  const {
    data: hash,
    writeContract,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash,
  });
  const [server, setServer] = useState<ServerState>({ kind: 'idle' });
  // Set once the server has verified the receipt; drives the completed state.
  const [paid, setPaid] = useState(false);

  // A hash sent in an earlier mount, restored from storage. The modal unmounts
  // this component when it closes, so this is what lets the payment resume
  // instead of starting from idle with no memory of the submitted transfer.
  const [resumedHash, setResumedHash] = useState<Hex | null>(() =>
    readPendingHash(treasuryAddress),
  );
  const txHash = hash ?? resumedHash ?? null;

  // Keep the latest callback without re-running the confirmation effect.
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  // The hash already acted on, so a single confirmed receipt is processed once.
  const handledRef = useRef<Hex | null>(null);

  const amountUnits = useMemo(() => parseUnits(amountUsdc, 6), [amountUsdc]);

  const onSepolia = Number(chainId) === sepolia.id;

  // Persist the hash the moment it exists, not only once the receipt confirms,
  // so closing the modal mid-confirmation cannot lose an in-flight payment.
  useEffect(() => {
    if (hash) writePendingHash(treasuryAddress, hash);
  }, [hash, treasuryAddress]);

  /**
   * Verify a hash against the server, which re-reads the Sepolia receipt.
   *
   * The server is the source of truth, so this runs as soon as there is a hash
   * and an address rather than waiting on the wagmi watcher: a resumed hash may
   * already be mined with no watcher left. A timeout guarantees the resident
   * gets a re-check rather than an indefinite "Confirming…".
   */
  const verify = useCallback(
    async (submitted: Hex, payer: string) => {
      setServer({ kind: 'verifying' });
      try {
        const result = await withTimeout(
          recordPreapprovalFeePayment(submitted, payer),
          VERIFY_TIMEOUT_MS,
        );
        if (result.status === 'paid') {
          clearPendingHash(treasuryAddress);
          setResumedHash(null);
          setPaid(true);
          onPaidRef.current(submitted);
          return;
        }
        if (result.status === 'pending') {
          // Still confirming is not a failure: stay on the loader and let the
          // poll below ask again. The hash is kept so a later mount can resume.
          handledRef.current = null;
          setServer({ kind: 'verifying' });
          return;
        }
        // Every other outcome is final, so the hash is no longer resumable.
        clearPendingHash(treasuryAddress);
        setResumedHash(null);
        setServer({
          kind: 'error',
          message: messageFor(result),
          ...recoveryFor(result.status),
        });
      } catch {
        // A timeout or a transient network failure is not a verdict on the
        // payment: the transaction may simply not be mined yet. Stay on the
        // loader and let the poll ask again, so the resident never sees an
        // error for a payment that is still confirming.
        handledRef.current = null;
        setServer({ kind: 'verifying' });
      }
    },
    [treasuryAddress],
  );

  useEffect(() => {
    if (!txHash || !address) return;
    if (handledRef.current === txHash) return;
    handledRef.current = txHash;
    void verify(txHash, address);
  }, [txHash, address, verify]);

  // While the payment is still confirming, keep asking on a short interval and
  // stay on the loader. A pending receipt is not a failure, so the resident is
  // never shown an error for a transaction that is simply not mined yet.
  useEffect(() => {
    if (server.kind !== 'verifying') return;
    if (!txHash || !address) return;
    const timer = setInterval(() => {
      void verify(txHash, address);
    }, PENDING_POLL_MS);
    return () => clearInterval(timer);
  }, [server, txHash, address, verify]);

  async function checkAgain() {
    if (!txHash || !address) return;
    await verify(txHash, address);
  }

  /** Send the fee to the treasury. */
  function pay() {
    handledRef.current = null;
    setResumedHash(null);
    setPaid(false);
    setServer({ kind: 'idle' });
    reset();
    writeContract({
      abi: USDC_ABI,
      address: usdcAddress,
      functionName: 'transfer',
      args: [treasuryAddress, amountUnits],
    });
  }

  if (!isConnected) {
    return (
      <div>
        <p style={statusText}>
          Pay {amountUsdc} USDC on Ethereum Sepolia. Connect a wallet to send it
          to Kade.
        </p>
        <button
          type='button'
          onClick={() => void open()}
          style={{ ...primaryButton, width: '100%' }}
        >
          Connect wallet
        </button>
      </div>
    );
  }

  if (!onSepolia) {
    return (
      <div>
        <p style={statusText}>
          Your wallet is on another network. Switch to Ethereum Sepolia to pay
          the fee.
        </p>
        <button
          type='button'
          onClick={() => void switchNetwork(sepolia)}
          style={{ ...primaryButton, width: '100%' }}
        >
          Switch to Ethereum Sepolia
        </button>
      </div>
    );
  }

  if (server.kind === 'error') {
    return (
      <div>
        <p style={{ ...statusText, color: tokens.danger }}>{server.message}</p>
        <div style={actions}>
          {server.canRecheck ? (
            <button
              type='button'
              onClick={() => void checkAgain()}
              style={primaryButton}
            >
              Check again
            </button>
          ) : null}
          {server.canRetryPayment ? (
            <button type='button' onClick={pay} style={secondaryButton}>
              Try the payment again
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // The receipt has been verified: the transaction link is offered only now,
  // never while the payment is still confirming, and the Close button is left
  // for the owner to lay out.
  if (paid) {
    return (
      <div data-testid='fee-complete-actions'>
        <p style={statusText}>
          Payment confirmed. Your file is open for pre-approval.
          <br/>
        
          {txHash ? (
            <a
              href={`${explorerUrl}/tx/${txHash}`}
              target='_blank'
              rel='noreferrer'
            >
             View transaction
            </a>
          ) : null}
        </p>

        <div style={actions}>
          {onClose ? (
            <button type='button' onClick={onClose} style={{ ...primaryButton, width: '100%' }}>
              Close
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const busy = isPending || isConfirming || server.kind === 'verifying';

  const status =
    server.kind === 'verifying'
      ? 'Confirming your payment on Sepolia…'
      : isPending
        ? 'Confirm the payment in your wallet…'
        : isConfirming
          ? 'Confirming your payment on Sepolia…'
          : `Sends ${amountUsdc} USDC to Kade on Ethereum Sepolia. Testnet funds only.`;

  return (
    <div>
      {busy ? (
        <div role='status' aria-live='polite' style={loaderRow}>
          <span
            role='progressbar'
            aria-label='Confirming payment'
            className='kade-spinner'
            style={spinner}
          />
          <span style={{ ...statusText, margin: 0 }}>{status}</span>
        </div>
      ) : (
        <p style={statusText}>{status}</p>
      )}

      <button
        type='button'
        onClick={pay}
        disabled={busy}
        style={{
          ...primaryButton,
          width: '100%',
          opacity: busy ? 0.6 : 1,
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {isPending
          ? 'Waiting for your wallet…'
          : busy
            ? 'Confirming…'
            : `Pay ${amountUsdc} USDC`}
      </button>

      {writeError ? (
        <p style={{ ...statusText, color: tokens.danger, marginTop: '8px' }}>
          The wallet rejected or could not send the payment.
        </p>
      ) : null}
    </div>
  );
}

const statusText: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: '13.5px',
  lineHeight: 1.5,
  color: tokens.muted,
};

const loaderRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  margin: '0 0 12px',
};

const spinner: React.CSSProperties = {
  width: '16px',
  height: '16px',
  flexShrink: 0,
  border: '2px solid rgba(16,24,40,.16)',
  borderTopColor: tokens.action,
  borderRadius: '999px',
};

const actions: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  gap: '8px',
  flexWrap: 'wrap',
};

const primaryButton: React.CSSProperties = {
  height: '46px',
  padding: '0 22px',
  border: 0,
  borderRadius: '999px',
  background: tokens.action,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButton: React.CSSProperties = {
  height: '46px',
  padding: '0 22px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  color: tokens.ink,
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
};


