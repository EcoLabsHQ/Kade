'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useAppKit,
  useAppKitAccount,
  useAppKitNetwork,
} from '@reown/appkit/react';
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { parseUnits, type Hex } from 'viem';
import { recordResidencyServiceFeePaymentAction } from '@/app/residency/actions';
import type { RecordFeeResult } from '@/lib/payments/preapproval-fee';
import { appkitNetworkForChainId } from '@/lib/wallet/appkit';
import { tokens } from '@/components/ui/tokens';

/**
 * The connect-and-pay control for the residency service fee (D16).
 *
 * The same shape as the pre-approval `FeePayment`: the resident connects a
 * wallet, switches to the settlement chain the server resolved
 * (`KADE_CHAIN_ENV`) and sends the fee as a direct USDC transfer to the Kade
 * treasury. The browser only sends; the server independently verifies the
 * transfer receipt before the fee is recorded, so nothing here can assert a
 * payment that did not happen.
 *
 * The amount, treasury, token and target chain are supplied by the server. This
 * component holds no fee value, no recipient default and no network literal.
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

const PENDING_POLL_MS = 4_000;

export interface ServiceFeePaymentProps {
  /** The server-resolved service fee, as a whole-USDC decimal string. */
  readonly amountUsdc: string;
  /** The chain the server resolved for the rail. */
  readonly chainId: number;
  /** The settlement chain's display name; all copy names it. */
  readonly chainName: string;
  readonly treasuryAddress: `0x${string}`;
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
      return 'Your application could not be found.';
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
  | { readonly kind: 'error'; readonly message: string };

export function ServiceFeePayment({
  amountUsdc,
  chainId,
  chainName,
  treasuryAddress,
  usdcAddress,
  explorerUrl,
  onPaid,
}: ServiceFeePaymentProps) {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { chainId: walletChainId, switchNetwork } = useAppKitNetwork();
  const { data: hash, writeContract, isPending, error: writeError, reset } =
    useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });
  const [server, setServer] = useState<ServerState>({ kind: 'idle' });
  const [paid, setPaid] = useState(false);

  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  const handledRef = useRef<Hex | null>(null);

  const amountUnits = useMemo(() => parseUnits(amountUsdc, 6), [amountUsdc]);
  // The target network is resolved from the server's chain id, never a literal,
  // so the control only offers to switch when AppKit actually knows the chain.
  const targetNetwork = appkitNetworkForChainId(chainId);
  const supported = targetNetwork !== undefined;
  const onTargetChain =
    targetNetwork !== undefined && Number(walletChainId) === targetNetwork.id;
  const mainnet = chainId === 1;

  const verify = useCallback(
    async (submitted: Hex, payer: string) => {
      setServer({ kind: 'verifying' });
      try {
        const result = await recordResidencyServiceFeePaymentAction(
          submitted,
          payer,
        );
        if (result.status === 'paid') {
          setPaid(true);
          onPaidRef.current(submitted);
          return;
        }
        if (result.status === 'pending') {
          handledRef.current = null;
          setServer({ kind: 'verifying' });
          return;
        }
        setServer({ kind: 'error', message: messageFor(result) });
      } catch {
        // A transient failure is not a verdict on the payment; keep polling.
        handledRef.current = null;
        setServer({ kind: 'verifying' });
      }
    },
    [],
  );

  useEffect(() => {
    if (!hash || !address) return;
    if (handledRef.current === hash) return;
    handledRef.current = hash;
    void verify(hash, address);
  }, [hash, address, verify]);

  useEffect(() => {
    if (paid || server.kind !== 'verifying' || !hash || !address) return;
    const timer = setInterval(() => void verify(hash, address), PENDING_POLL_MS);
    return () => clearInterval(timer);
  }, [paid, server, hash, address, verify]);

  function pay() {
    handledRef.current = null;
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

  // Placed after every hook so the hook order stays unconditional.
  if (!supported || !targetNetwork) {
    return (
      <p style={statusText}>
        Payment on this chain is not configured in this build.
      </p>
    );
  }

  if (!isConnected) {
    return (
      <div>
        <p style={statusText}>
          Pay {amountUsdc} USDC on {chainName}. Connect a wallet to send it to
          Kade.
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

  if (!onTargetChain) {
    return (
      <div>
        <p style={statusText}>
          Your wallet is on another network. Switch to {chainName} to pay the
          fee.
        </p>
        <button
          type="button"
          onClick={() => void switchNetwork(targetNetwork)}
          style={{ ...primaryButton, width: '100%' }}
        >
          Switch to {chainName}
        </button>
      </div>
    );
  }

  if (paid) {
    return (
      <div data-testid="service-fee-complete-actions">
        <p style={statusText}>
          Service fee verified. Your residency file is with the programme.
          {hash ? (
            <>
              <br />
              <a href={`${explorerUrl}/tx/${hash}`} target="_blank" rel="noreferrer">
                View transaction
              </a>
            </>
          ) : null}
        </p>
      </div>
    );
  }

  if (server.kind === 'error') {
    return (
      <div>
        <p style={{ ...statusText, color: tokens.danger }}>{server.message}</p>
        <button type="button" onClick={pay} style={secondaryButton}>
          Try the payment again
        </button>
      </div>
    );
  }

  const busy = isPending || isConfirming || server.kind === 'verifying';
  const status =
    server.kind === 'verifying'
      ? `Confirming your payment on ${chainName}…`
      : isPending
        ? 'Confirm the payment in your wallet…'
        : isConfirming
          ? `Confirming your payment on ${chainName}…`
          : mainnet
            ? `Sends ${amountUsdc} USDC to Kade on ${chainName}. This is real USDC.`
            : `Sends ${amountUsdc} USDC to Kade on ${chainName}. Testnet funds only.`;

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
