'use client';

import { useEffect, useState } from 'react';
import { useAppKit, useAppKitAccount } from '@reown/appkit/react';
import {
  useDisconnect,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { erc20Abi, type Address } from 'viem';
import { Modal } from '@/components/ui/Modal';
import { tokens } from '@/components/ui/tokens';
import { shortAddress } from '@/lib/wealth/format';
import {
  assertCorrectWallet,
  buildEoaToSafeTransfer,
  validateTransferAmount,
  WrongWalletError,
} from '@/lib/safe/eoa-transfer';
import type { MoveToVaultTarget } from './HoldingsScreen';

/**
 * The "Move to vault" dialog.
 *
 * It moves the token of the row that was clicked — never a token chosen here.
 * The amount is the only free input; the destination is the resident's Safe and
 * the signer is the resident's own connected wallet, which pays the gas. The
 * call is built by `buildEoaToSafeTransfer` (a plain ERC-20 `transfer(safe,
 * amount)`) and sent through wagmi's `useWriteContract`, the same house idiom as
 * the fee payment.
 *
 * The wallet must be the one the row belongs to. A mismatch is refused with an
 * error and the wallet is disconnected, so a transfer can never be signed by
 * the wrong account.
 *
 * Hooks are gated on `configured` in the outer component, so the unconfigured
 * path renders static markup and reaches no AppKit/wagmi hook.
 */

export interface MoveToVaultDialogProps {
  readonly configured: boolean;
  /** The clicked row: its token, chain, owning wallet and read amount. */
  readonly target: MoveToVaultTarget;
  /** The resident's Safe (the destination), or null when not recorded. */
  readonly safeAddress: string | null;
  readonly onClose: () => void;
  /** Called once the transfer is confirmed, so the page can refresh. */
  readonly onDone?: () => void;
}

export function MoveToVaultDialog({
  configured,
  target,
  safeAddress,
  onClose,
  onDone,
}: MoveToVaultDialogProps) {
  return (
    <Modal open onClose={onClose} title="Move to vault">
      {configured ? (
        <ConfiguredBody
          target={target}
          safeAddress={safeAddress}
          onClose={onClose}
          onDone={onDone}
        />
      ) : (
        <UnconfiguredBody />
      )}
    </Modal>
  );
}

function UnconfiguredBody() {
  return (
    <div style={body}>
      <p style={bodyText}>
        Wallet connection is not configured in this environment, so this holding
        cannot be moved to your vault.
      </p>
    </div>
  );
}

function ConfiguredBody({
  target,
  safeAddress,
  onClose,
  onDone,
}: Omit<MoveToVaultDialogProps, 'configured'>) {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { disconnect } = useDisconnect();
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

  const [amount, setAmount] = useState(target.amount);
  const [error, setError] = useState<string | null>(null);
  const [announced, setAnnounced] = useState(false);

  const amountError = validateTransferAmount(amount, target.decimals);
  const safeReady = typeof safeAddress === 'string' && safeAddress.trim() !== '';
  const tokenReady = target.tokenAddress !== null;
  const busy = isPending || isConfirming;

  // Report the confirmed move upward exactly once, so the page can re-read the
  // vault balance. The dialog stays open on its success state.
  useEffect(() => {
    if (isSuccess && !announced) {
      setAnnounced(true);
      onDone?.();
    }
  }, [isSuccess, announced, onDone]);

  function confirm() {
    setError(null);
    reset();

    // The row's token belongs to one wallet: only that wallet may sign. A
    // mismatch is an error AND the wrong wallet is disconnected.
    try {
      assertCorrectWallet(target.address, address ?? null);
    } catch (cause) {
      setError(
        cause instanceof WrongWalletError
          ? cause.message
          : 'The connected wallet is not the wallet this holding belongs to.',
      );
      void disconnect();
      return;
    }

    if (!tokenReady || !safeReady) {
      setError('This holding cannot be moved right now.');
      return;
    }

    try {
      const plan = buildEoaToSafeTransfer({
        chainId: target.chainId,
        token: target.tokenAddress as Address,
        safeAddress: safeAddress as Address,
        amount,
        decimals: target.decimals,
      });
      writeContract({
        abi: erc20Abi,
        address: plan.token,
        functionName: 'transfer',
        args: [plan.to, plan.amountUnits],
        chainId: plan.chainId,
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The transfer could not be prepared.',
      );
    }
  }

  if (isSuccess) {
    return (
      <div style={body} data-testid="move-to-vault-complete">
        <p style={{ ...bodyText, color: tokens.success }}>
          Moved {amount} {target.symbol} to your vault.
        </p>
        {hash ? (
          <p style={hashLine} title={hash}>
            Transaction {shortHash(hash)}
          </p>
        ) : null}
        <div style={actions}>
          <button type="button" onClick={onClose} style={primaryButton}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div style={body}>
        <Summary target={target} safeAddress={safeAddress} connected={null} />
        <p style={bodyText}>
          Connect the wallet this holding belongs to, sign the transfer, and it
          pays the gas. The tokens go to your vault.
        </p>
        <div style={actions}>
          <button
            type="button"
            onClick={() => void open()}
            style={primaryButton}
          >
            Connect wallet
          </button>
          <button type="button" onClick={onClose} style={secondaryButton}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (!tokenReady || !safeReady) {
    return (
      <div style={body}>
        <Summary target={target} safeAddress={safeAddress} connected={address ?? null} />
        <p style={bodyText}>
          {!safeReady
            ? 'Your vault address is not ready yet, so there is nowhere to send this holding.'
            : 'This holding cannot be moved right now.'}
        </p>
        <div style={actions}>
          <button type="button" onClick={onClose} style={secondaryButton}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={body}>
      <Summary target={target} safeAddress={safeAddress} connected={address ?? null} />

      <label style={fieldLabel} htmlFor="move-to-vault-amount">
        Amount ({target.symbol})
      </label>
      <input
        id="move-to-vault-amount"
        inputMode="decimal"
        autoComplete="off"
        value={amount}
        onChange={(event) => {
          setAmount(event.target.value);
          setError(null);
        }}
        style={amountInput}
      />
      {amountError ? (
        <div role="alert" style={errorText}>
          {amountError}
        </div>
      ) : null}

      {error ? (
        <div role="alert" style={errorText}>
          {error}
        </div>
      ) : null}

      {writeError ? (
        <div role="alert" style={errorText}>
          The wallet rejected or could not send the transfer.
        </div>
      ) : null}

      <div style={actions}>
        <button
          type="button"
          onClick={confirm}
          disabled={busy || amountError !== null}
          style={{
            ...primaryButton,
            opacity: busy || amountError !== null ? 0.6 : 1,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {isPending
            ? 'Waiting for your wallet…'
            : isConfirming
              ? 'Confirming…'
              : `Move ${amount || '0'} ${target.symbol}`}
        </button>
        <button type="button" onClick={onClose} style={secondaryButton}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The row's token, chain, owning wallet and destination Safe. */
function Summary({
  target,
  safeAddress,
  connected,
}: {
  readonly target: MoveToVaultTarget;
  readonly safeAddress: string | null;
  readonly connected: string | null;
}) {
  return (
    <dl style={summary}>
      <div style={summaryRow}>
        <dt style={summaryKey}>Token</dt>
        <dd style={summaryValue}>
          {target.symbol} · {target.chainName}
        </dd>
      </div>
      <div style={summaryRow}>
        <dt style={summaryKey}>From</dt>
        <dd
          style={{ ...summaryValue, ...monoValue }}
          title={target.address}
        >
          {shortAddress(target.address)}
        </dd>
      </div>
      <div style={summaryRow}>
        <dt style={summaryKey}>Connected</dt>
        <dd style={{ ...summaryValue, ...monoValue }} title={connected ?? undefined}>
          {connected ? shortAddress(connected) : 'Not connected'}
        </dd>
      </div>
      <div style={summaryRow}>
        <dt style={summaryKey}>To (your vault)</dt>
        <dd
          style={{ ...summaryValue, ...monoValue }}
          title={safeAddress ?? undefined}
        >
          {safeAddress ? shortAddress(safeAddress) : 'Not available'}
        </dd>
      </div>
    </dl>
  );
}

/** Shorten a transaction hash for display; the full value stays in `title`. */
function shortHash(hash: string): string {
  return hash.length <= 16 ? hash : `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

const body: React.CSSProperties = {
  padding: '16px 24px 24px',
};

const bodyText: React.CSSProperties = {
  margin: '12px 0 0',
  fontSize: '13.5px',
  lineHeight: 1.6,
  color: tokens.chipFg,
};

const summary: React.CSSProperties = {
  margin: 0,
  border: `1px solid ${tokens.border}`,
  borderRadius: '12px',
  padding: '12px 14px',
  background: tokens.surface,
};

const summaryRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '4px 0',
};

const summaryKey: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  color: tokens.muted,
};

const summaryValue: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  fontWeight: 600,
  textAlign: 'right',
};

const monoValue: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontWeight: 600,
};

const fieldLabel: React.CSSProperties = {
  display: 'block',
  margin: '16px 0 6px',
  fontSize: '12.5px',
  fontWeight: 600,
  color: tokens.ink,
};

const amountInput: React.CSSProperties = {
  width: '100%',
  height: '42px',
  padding: '0 12px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '10px',
  fontFamily: 'inherit',
  fontSize: '14px',
  color: tokens.ink,
  fontVariantNumeric: 'tabular-nums',
};

const hashLine: React.CSSProperties = {
  margin: '8px 0 0',
  fontSize: '12.5px',
  color: tokens.muted,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

const actions: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '10px',
  marginTop: '18px',
  flexWrap: 'wrap',
};

const primaryButton: React.CSSProperties = {
  height: '40px',
  padding: '0 18px',
  border: 0,
  borderRadius: '999px',
  background: tokens.action,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
};

const secondaryButton: React.CSSProperties = {
  height: '40px',
  padding: '0 18px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  color: tokens.ink,
  fontFamily: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
  cursor: 'pointer',
};

const errorText: React.CSSProperties = {
  margin: '8px 0 0',
  fontSize: '12.5px',
  color: tokens.danger,
};
