'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

/** Which recovery a failed verification offers. */
function recoveryFor(status: RecordFeeResult['status']): {
  readonly canRecheck: boolean;
  readonly canRetryPayment: boolean;
} {
  switch (status) {
    case 'pending':
      return { canRecheck: true, canRetryPayment: false };
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

export function FeePayment({
  amountUsdc,
  treasuryAddress,
  usdcAddress,
  explorerUrl,
  onPaid,
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
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });
  const [server, setServer] = useState<ServerState>({ kind: 'idle' });

  // Keep the latest callback without re-running the confirmation effect.
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  // The hash already acted on, so a single confirmed receipt is processed once.
  const handledRef = useRef<Hex | null>(null);

  const amountUnits = useMemo(
    () => parseUnits(amountUsdc, 6),
    [amountUsdc],
  );

  const onSepolia = Number(chainId) === sepolia.id;

  useEffect(() => {
    if (!isSuccess || !hash || !address) return;
    if (handledRef.current === hash) return;
    handledRef.current = hash;

    let active = true;
    setServer({ kind: 'verifying' });
    recordPreapprovalFeePayment(hash, address)
      .then((result) => {
        if (!active) return;
        if (result.status === 'paid') {
          onPaidRef.current(hash);
          return;
        }
        setServer({
          kind: 'error',
          message: messageFor(result),
          ...recoveryFor(result.status),
        });
      })
      .catch(() => {
        if (active) {
          setServer({
            kind: 'error',
            message: 'We could not confirm the payment. Please try again.',
            canRecheck: true,
            canRetryPayment: false,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [isSuccess, hash, address]);

  async function checkAgain() {
    if (!hash || !address) return;
    setServer({ kind: 'verifying' });
    try {
      const result = await recordPreapprovalFeePayment(hash, address);
      if (result.status === 'paid') {
        onPaidRef.current(hash);
        return;
      }
      setServer({
        kind: 'error',
        message: messageFor(result),
        ...recoveryFor(result.status),
      });
    } catch {
      setServer({
        kind: 'error',
        message: 'We could not confirm the payment. Please try again.',
        canRecheck: true,
        canRetryPayment: false,
      });
    }
  }

  /** Send the fee to the treasury. */
  function pay() {
    handledRef.current = null;
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
          type="button"
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
          type="button"
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
        <p style={{ ...statusText, color: '#FECDCA' }}>{server.message}</p>
        <div style={actions}>
          {server.canRecheck ? (
            <button type="button" onClick={() => void checkAgain()} style={primaryButton}>
              Check again
            </button>
          ) : null}
          {server.canRetryPayment ? (
            <button type="button" onClick={pay} style={secondaryButtonDark}>
              Try the payment again
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
      <p style={statusText}>{status}</p>

      <button
        type="button"
        onClick={pay}
        disabled={busy}
        style={{
          ...primaryButton,
          width: '100%',
          opacity: busy ? 0.6 : 1,
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {isPending ? 'Waiting for your wallet…' : `Pay ${amountUsdc} USDC`}
      </button>

      {hash ? (
        <a
          href={`${explorerUrl}/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
          style={hashLink}
        >
          View transaction
        </a>
      ) : null}
      {writeError ? (
        <p style={{ ...statusText, color: '#FECDCA', marginTop: '8px' }}>
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
  color: '#D0D5DD',
};

const actions: React.CSSProperties = {
  display: 'flex',
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

const secondaryButtonDark: React.CSSProperties = {
  height: '46px',
  padding: '0 22px',
  border: '1px solid #667085',
  borderRadius: '999px',
  background: 'transparent',
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
};

const hashLink: React.CSSProperties = {
  display: 'inline-block',
  marginTop: '10px',
  fontSize: '12.5px',
  color: '#98C5FF',
  textDecoration: 'underline',
};
