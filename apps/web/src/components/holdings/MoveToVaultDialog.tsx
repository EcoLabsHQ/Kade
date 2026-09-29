'use client';

import { useEffect, useState } from 'react';
import { useAppKit, useAppKitAccount } from '@reown/appkit/react';
import {
  useChainId,
  useDisconnect,
  useSendTransaction,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { erc20Abi, type Address } from 'viem';
import { Modal } from '@/components/ui/Modal';
import { CopyableValue } from '@/components/ui/CopyableValue';
import { TransactionProgress } from '@/components/ui/TransactionProgress';
import { tokens } from '@/components/ui/tokens';
import { addressExplorerUrl, transactionExplorerUrl } from '@/lib/wealth/explorer';
import {
  assertCorrectWallet,
  buildEoaToSafeNativeTransfer,
  buildEoaToSafeTransfer,
  validateTransferAmount,
  WrongWalletError,
} from '@/lib/safe/eoa-transfer';
import type { MoveToVaultTarget } from './HoldingsScreen';

/**
 * The "Move to vault" dialog.
 *
 * It moves the holding of the row that was clicked — never an asset chosen
 * here. The amount is the only free input; the destination is the resident's
 * Safe and the signer is the resident's own connected wallet, which pays the
 * gas.
 *
 * The holding sits on a specific chain, and the transfer must run on that
 * chain. If the wallet is elsewhere it is asked to switch (`useSwitchChain`);
 * a refused or unavailable switch is reported and **nothing is sent**, so a
 * transfer is never broadcast on the wrong chain. The builders pass the
 * holding's `chainId` to wagmi, which refuses if the wallet did not in fact
 * switch.
 *
 * An ERC-20 holding is sent through wagmi's `useWriteContract` (a plain
 * `transfer(safe, amount)`, the same house idiom as the fee payment); the
 * chain's native coin has no contract, so it is sent through
 * `useSendTransaction` as `{ to, value }`. Moving the native coin can leave the
 * wallet without gas, which the dialog warns about.
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
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const {
    data: writeHash,
    writeContract,
    isPending: isWritePending,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();
  const {
    data: sendHash,
    sendTransaction,
    isPending: isSendPending,
    error: sendError,
    reset: resetSend,
  } = useSendTransaction();
  const hash = writeHash ?? sendHash;
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  const [amount, setAmount] = useState(target.amount);
  const [error, setError] = useState<string | null>(null);
  const [announced, setAnnounced] = useState(false);
  const [switching, setSwitching] = useState(false);

  const isNative = target.kind === 'native';
  const amountError = validateTransferAmount(amount, target.decimals);
  const safeReady = typeof safeAddress === 'string' && safeAddress.trim() !== '';
  const tokenReady = isNative || target.tokenAddress !== null;
  const txError = writeError ?? sendError;
  const isPending = isWritePending || isSendPending;
  const busy = isPending || isConfirming || switching;

  function reset() {
    resetWrite();
    resetSend();
  }

  // Report the confirmed move upward exactly once, so the page can re-read the
  // vault balance. The dialog stays open on its success state.
  useEffect(() => {
    if (isSuccess && !announced) {
      setAnnounced(true);
      onDone?.();
    }
  }, [isSuccess, announced, onDone]);

  async function confirm() {
    setError(null);
    reset();

    // The row's holding belongs to one wallet: only that wallet may sign. A
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

    // The transfer must run on the holding's own chain. If the wallet is
    // elsewhere, ask it to switch; a refusal (or a connector that cannot
    // switch) is reported and nothing is sent.
    if (chainId !== target.chainId) {
      setSwitching(true);
      try {
        await switchChainAsync({ chainId: target.chainId });
      } catch (cause) {
        setError(
          `Could not switch your wallet to ${target.chainName}: ` +
            `${errorReason(cause)} Nothing was sent.`,
        );
        return;
      } finally {
        setSwitching(false);
      }
    }

    try {
      if (isNative) {
        const plan = buildEoaToSafeNativeTransfer({
          chainId: target.chainId,
          safeAddress: safeAddress as Address,
          amount,
        });
        sendTransaction({
          to: plan.to,
          value: plan.value,
          chainId: plan.chainId,
        });
      } else {
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
      }
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
        <p style={{ ...bodyText, marginTop: '4px' }}>
          The transfer is confirmed on {target.chainName}.
        </p>
        <dl style={summary}>
          {hash ? (
            <div style={summaryRow}>
              <dt style={summaryKey}>Transaction</dt>
              <dd style={{ ...summaryValue, minWidth: 0 }}>
                <CopyableValue
                  value={hash}
                  label="transaction hash"
                  explorerUrl={transactionExplorerUrl(target.chainId, hash)}
                />
              </dd>
            </div>
          ) : null}
          {safeReady && safeAddress ? (
            <div style={summaryRow}>
              <dt style={summaryKey}>To (your vault)</dt>
              <dd style={{ ...summaryValue, minWidth: 0 }}>
                <CopyableValue
                  value={safeAddress}
                  label="vault address"
                  explorerUrl={addressExplorerUrl(target.chainId, safeAddress)}
                />
              </dd>
            </div>
          ) : null}
        </dl>
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

      {isNative ? (
        <p style={warningText} role="note">
          {target.symbol} is {target.chainName}&rsquo;s native coin. If you move
          all of it, nothing is left in this wallet to pay gas for later
          transfers.
        </p>
      ) : null}

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

      {txError ? (
        <div role="alert" style={errorText}>
          The wallet rejected or could not send the transfer: {errorReason(txError)}
        </div>
      ) : null}

      {busy ? (
        <TransactionProgress
          label={
            switching
              ? `Switching your wallet to ${target.chainName}…`
              : isPending
                ? 'Waiting for your wallet to sign the transfer…'
                : `Confirming the transfer on ${target.chainName}…`
          }
          progressLabel="Confirming move to vault"
        />
      ) : null}

      <div style={actions}>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={busy || amountError !== null}
          style={{
            ...primaryButton,
            opacity: busy || amountError !== null ? 0.6 : 1,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {switching
            ? `Switching to ${target.chainName}…`
            : isPending
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

/**
 * The readable reason behind a wallet/chain/contract failure.
 *
 * viem and wallet connectors put the useful explanation on `shortMessage`
 * (e.g. "User rejected the request.") or `message`; the dialog shows it rather
 * than a fixed string that hides the cause.
 */
function errorReason(error: unknown): string {
  if (error && typeof error === 'object') {
    const short = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof short === 'string' && short.trim() !== '') return short.trim();
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message.trim();
  }
  if (typeof error === 'string' && error.trim() !== '') return error.trim();
  return 'the wallet could not complete it.';
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
        <dd style={{ ...summaryValue, minWidth: 0 }}>
          <CopyableValue
            value={target.address}
            label="source wallet address"
            explorerUrl={addressExplorerUrl(target.chainId, target.address)}
          />
        </dd>
      </div>
      <div style={summaryRow}>
        <dt style={summaryKey}>Connected</dt>
        <dd style={{ ...summaryValue, minWidth: 0 }}>
          {connected ? (
            <CopyableValue value={connected} label="connected wallet address" />
          ) : (
            'Not connected'
          )}
        </dd>
      </div>
      <div style={summaryRow}>
        <dt style={summaryKey}>To (your vault)</dt>
        <dd style={{ ...summaryValue, minWidth: 0 }}>
          {safeAddress ? (
            <CopyableValue
              value={safeAddress}
              label="vault address"
              explorerUrl={addressExplorerUrl(target.chainId, safeAddress)}
            />
          ) : (
            'Not available'
          )}
        </dd>
      </div>
    </dl>
  );
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

const warningText: React.CSSProperties = {
  margin: '10px 0 0',
  fontSize: '12.5px',
  lineHeight: 1.5,
  color: tokens.warning,
};
