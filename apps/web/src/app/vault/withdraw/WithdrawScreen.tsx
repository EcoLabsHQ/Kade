'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChainChip } from '@/components/ui/ChainChip';
import { CopyableValue } from '@/components/ui/CopyableValue';
import { Notice } from '@/components/ui/Notice';
import { TransactionProgress } from '@/components/ui/TransactionProgress';
import { tokens } from '@/components/ui/tokens';
import { chainColor } from '@/lib/wealth/chain-colors';
import { transactionExplorerUrl } from '@/lib/wealth/explorer';
import {
  beginOperatorWithdraw,
  completeOperatorWithdraw,
} from '@/app/vault/withdraw/actions';
import { promptPasskeyAssertionParts } from '@/lib/passkey/assertion';
import {
  NATIVE_DECIMALS,
  USDC_DECIMALS,
  type OperatorWithdrawBalance,
  type OperatorWithdrawToken,
} from './types';

/**
 * The operator-withdrawal screen.
 *
 * This is deliberately unlinked, off-by-default operator tooling (see
 * `docs/operator-vault-withdraw.md`). It is the browser half of the two-phase
 * passkey flow in `./actions`: the server builds the transfer and returns the
 * SafeOp hash (`beginOperatorWithdraw`), the browser signs it with the
 * resident's passkey (`promptPasskeyAssertionParts`), and the server submits
 * the retained operation and confirms the receipt (`completeOperatorWithdraw`).
 *
 * The screen shows the Safe's balances as read server-side and passed in (no
 * amount is fetched or hard-coded here). Success is reported only for a
 * confirmed receipt; every refusal names its reason. The passkey is the only
 * signer — the connected browser wallet is never used and has no authority.
 */

export interface WithdrawScreenProps {
  /** The resident Safe, or null when none is recorded. */
  readonly safeAddress: string | null;
  /** The Safe's balances per supported chain, read server-side. */
  readonly balances: readonly OperatorWithdrawBalance[];
}

type WithdrawState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'building' }
  | { readonly kind: 'awaiting-passkey' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'gated'; readonly reason: string }
  | {
      readonly kind: 'failed';
      readonly stage: string;
      readonly reason: string;
      readonly sent: boolean;
      readonly chainName: string;
    }
  | {
      readonly kind: 'sent';
      readonly transactionHash: string | null;
      readonly userOperationHash: string;
      readonly chainId: number;
      readonly chainName: string;
      readonly amount: string;
      readonly token: OperatorWithdrawToken;
      readonly destination: string;
    };

/** A readable message from an unknown thrown value. */
function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Convert a decimal amount to its smallest-unit integer string, or null when it
 * is not a non-negative decimal with at most `decimals` places. Pure string
 * arithmetic, so no big-number library is needed in the browser.
 */
function toBaseUnits(value: string, decimals: number): string | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d*)?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) return null;
  const digits = `${whole}${fraction.padEnd(decimals, '0')}`.replace(
    /^0+(?=\d)/,
    '',
  );
  return digits === '' ? '0' : digits;
}

/** The formatted balance for the selected chain and token, or null. */
function balanceFor(
  balances: readonly OperatorWithdrawBalance[],
  chainId: number,
  token: OperatorWithdrawToken,
): { readonly amount: string | null; readonly reason: string | null } {
  const row = balances.find((balance) => balance.chainId === chainId);
  if (!row) return { amount: null, reason: 'This chain has no balance read.' };
  return token === 'native'
    ? { amount: row.nativeAmount, reason: row.nativeReason }
    : { amount: row.usdcAmount, reason: row.usdcReason };
}

export function WithdrawScreen({ safeAddress, balances }: WithdrawScreenProps) {
  const [chainId, setChainId] = useState<number | null>(
    balances[0]?.chainId ?? null,
  );
  const [token, setToken] = useState<OperatorWithdrawToken>('usdc');
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [state, setState] = useState<WithdrawState>({ kind: 'idle' });

  const selectedBalance = balances.find((balance) => balance.chainId === chainId) ?? null;
  const selected = balanceFor(balances, chainId ?? -1, token);
  const decimals = token === 'native' ? NATIVE_DECIMALS : USDC_DECIMALS;
  const amountUnits = toBaseUnits(amount, decimals);
  const amountValid = amountUnits !== null && amountUnits !== '0';
  const destinationValid = destination.trim() !== '';
  const busy =
    state.kind === 'building' ||
    state.kind === 'awaiting-passkey' ||
    state.kind === 'submitting';
  const canWithdraw =
    safeAddress !== null &&
    selectedBalance !== null &&
    selected.amount !== null &&
    amountValid &&
    destinationValid;

  function setAll() {
    if (selected.amount !== null) setAmount(selected.amount);
  }

  async function runWithdraw() {
    if (
      !canWithdraw ||
      safeAddress === null ||
      selectedBalance === null ||
      amountUnits === null
    ) {
      return;
    }
    const chainName = selectedBalance.chainName;
    const destinationTrimmed = destination.trim();

    setState({ kind: 'building' });
    let begin;
    try {
      begin = await beginOperatorWithdraw({
        safeAddress,
        chainId: selectedBalance.chainId,
        token,
        destination: destinationTrimmed,
        amount: amountUnits,
      });
    } catch (cause) {
      setState({
        kind: 'failed',
        stage: 'build',
        reason: describeError(cause),
        sent: false,
        chainName,
      });
      return;
    }

    if (begin.status === 'gated') {
      setState({ kind: 'gated', reason: begin.reason });
      return;
    }

    setState({ kind: 'awaiting-passkey' });
    let assertion;
    try {
      assertion = await promptPasskeyAssertionParts({
        credentialId: begin.credentialId,
        challenge: begin.hash,
        rpId:
          typeof window === 'undefined'
            ? 'localhost'
            : window.location.hostname,
      });
    } catch (cause) {
      setState({
        kind: 'failed',
        stage: 'passkey',
        reason: describeError(cause),
        sent: false,
        chainName,
      });
      return;
    }

    const builtChainId = begin.chainId;
    const builtChainName =
      balances.find((balance) => balance.chainId === builtChainId)?.chainName ??
      chainName;

    setState({ kind: 'submitting' });
    let result;
    try {
      result = await completeOperatorWithdraw({
        token: begin.token,
        assertion,
        chainId: builtChainId,
      });
    } catch (cause) {
      setState({
        kind: 'failed',
        stage: 'submit',
        reason: describeError(cause),
        sent: false,
        chainName: builtChainName,
      });
      return;
    }

    if (result.status === 'sent') {
      setState({
        kind: 'sent',
        transactionHash: result.transactionHash,
        userOperationHash: result.userOperationHash,
        chainId: builtChainId,
        chainName: builtChainName,
        amount,
        token,
        destination: destinationTrimmed,
      });
      return;
    }

    if (result.status === 'not-configured') {
      setState({ kind: 'gated', reason: result.reason });
      return;
    }

    setState({
      kind: 'failed',
      stage: result.stage,
      reason: result.reason,
      sent: result.sent,
      chainName: builtChainName,
    });
  }

  return (
    <div style={{ animation: 'fadeUp .2s ease-out' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1
          style={{
            margin: 0,
            fontSize: '32px',
            lineHeight: 1.1,
            fontWeight: 700,
            letterSpacing: '-.02em',
          }}
        >
          Operator withdrawal
        </h1>
        <p
          style={{
            margin: '10px 0 0',
            color: tokens.muted,
            maxWidth: '62ch',
            textWrap: 'pretty',
          }}
        >
          Move funds out of the resident Safe to a destination you name. This
          route is unlinked and disabled unless the deployment sets{' '}
          <code>KADE_OPERATOR_WITHDRAW=1</code>. The resident&apos;s passkey is
          the only signer, so nothing moves without it.
        </p>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <Notice tone='warning' title='Operator tooling'>
          This is not part of the resident app and is not linked from it. The
          connected browser wallet has no authority here; only the resident
          passkey can authorise a withdrawal.
        </Notice>
      </div>

      <Card style={{ marginBottom: '16px' }}>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: tokens.muted,
            marginBottom: '8px',
          }}
        >
          Safe
        </div>
        {safeAddress ? (
          <CopyableValue value={safeAddress} label='Safe address' />
        ) : (
          <span style={{ fontSize: '13px', color: tokens.muted }}>
            No Safe is recorded for this account.
          </span>
        )}
      </Card>

      <Card style={{ marginBottom: '16px' }}>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: tokens.muted,
            marginBottom: '12px',
          }}
        >
          Balances
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {balances.map((balance) => (
            <div
              key={balance.chainId}
              data-testid={`operator-balance-${balance.chainId}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'wrap',
                fontSize: '13px',
              }}
            >
              <ChainChip
                name={balance.chainName}
                color={chainColor(balance.chainName)}
              />
              <span
                style={{
                  display: 'flex',
                  gap: '18px',
                  fontVariantNumeric: 'tabular-nums',
                  color: tokens.chipFg,
                }}
              >
                <span title={balance.usdcReason ?? undefined}>
                  {balance.usdcAmount !== null
                    ? `${balance.usdcAmount} USDC`
                    : 'USDC unread'}
                </span>
                <span title={balance.nativeReason ?? undefined}>
                  {balance.nativeAmount !== null
                    ? `${balance.nativeAmount} ${balance.nativeSymbol}`
                    : `${balance.nativeSymbol} unread`}
                </span>
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '14px',
          }}
        >
          <label style={fieldLabel}>
            Chain
            <select
              aria-label='Chain'
              value={chainId ?? ''}
              disabled={busy}
              onChange={(event) => setChainId(Number(event.target.value))}
              style={fieldInput}
            >
              {balances.map((balance) => (
                <option key={balance.chainId} value={balance.chainId}>
                  {balance.chainName}
                </option>
              ))}
            </select>
          </label>

          <label style={fieldLabel}>
            Token
            <select
              aria-label='Token'
              value={token}
              disabled={busy}
              onChange={(event) =>
                setToken(event.target.value as OperatorWithdrawToken)
              }
              style={fieldInput}
            >
              <option value='usdc'>USDC</option>
              <option value='native'>Native coin</option>
            </select>
          </label>
        </div>

        <label style={{ ...fieldLabel, marginTop: '14px' }}>
          Amount
          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <input
              type='text'
              inputMode='decimal'
              aria-label='Amount'
              value={amount}
              disabled={busy}
              spellCheck={false}
              onChange={(event) => setAmount(event.target.value)}
              style={{ ...fieldInput, marginTop: 0, flex: '1 1 auto' }}
            />
            <Button
              variant='secondary'
              onClick={setAll}
              disabled={busy || selected.amount === null}
              ariaLabel='Use the full balance'
              title={
                selected.amount === null
                  ? (selected.reason ?? 'The balance could not be read.')
                  : 'Use the full balance'
              }
            >
              All
            </Button>
          </div>
        </label>

        <label style={{ ...fieldLabel, marginTop: '14px' }}>
          Destination address
          <input
            type='text'
            aria-label='Destination address'
            value={destination}
            disabled={busy}
            spellCheck={false}
            placeholder='0x…'
            onChange={(event) => setDestination(event.target.value)}
            style={fieldInput}
          />
        </label>

        <div
          style={{
            display: 'flex',
            gap: '10px',
            marginTop: '18px',
            flexWrap: 'wrap',
          }}
        >
          <Button
            variant={canWithdraw ? 'primary' : 'locked'}
            disabled={!canWithdraw || busy}
            onClick={() => void runWithdraw()}
            ariaLabel='Build the withdrawal'
            title={
              safeAddress === null
                ? 'No Safe is recorded for this account'
                : selectedBalance === null
                  ? 'Select a chain'
                  : selected.amount === null
                    ? (selected.reason ?? 'The balance could not be read')
                    : !destinationValid
                      ? 'Enter a destination address'
                      : !amountValid
                        ? 'Enter a positive amount'
                        : 'Build, sign and submit the withdrawal'
            }
          >
            {state.kind === 'building'
              ? 'Building…'
              : state.kind === 'awaiting-passkey'
                ? 'Confirm with your passkey…'
                : state.kind === 'submitting'
                  ? 'Submitting…'
                  : 'Withdraw'}
          </Button>
        </div>

        {state.kind === 'building' ? (
          <TransactionProgress
            label='Building the withdrawal…'
            progressLabel='Building the withdrawal'
          />
        ) : null}
        {state.kind === 'awaiting-passkey' ? (
          <TransactionProgress
            label='Waiting for your passkey to authorise the withdrawal…'
            progressLabel='Awaiting your passkey'
          />
        ) : null}
        {state.kind === 'submitting' ? (
          <TransactionProgress
            label={`Submitting and confirming the withdrawal on ${
              selectedBalance?.chainName ?? ''
            }…`}
            progressLabel='Confirming the withdrawal'
          />
        ) : null}

        {state.kind === 'gated' ? (
          <Notice tone='warning' title='Withdrawal gated' style={noticeSpacing}>
            {state.reason}
            <div style={{ marginTop: '6px' }}>Nothing was signed or sent.</div>
          </Notice>
        ) : null}

        {state.kind === 'failed' ? (
          <Notice tone='error' title='Withdrawal failed' style={noticeSpacing}>
            The withdrawal on {state.chainName} stopped at the{' '}
            <strong>{state.stage}</strong> step: {state.reason}
            <div style={{ marginTop: '6px' }}>
              {state.sent
                ? 'The operation reached the bundler but was not confirmed.'
                : 'Nothing was sent.'}
            </div>
          </Notice>
        ) : null}

        {state.kind === 'sent' ? (
          <div
            data-testid='operator-withdraw-complete'
            style={{ marginTop: '14px' }}
          >
            <Notice tone='success' title='Withdrawal submitted'>
              The withdrawal of {state.amount} {state.token === 'native' ? 'native' : 'USDC'}{' '}
              to {state.destination} was submitted and its receipt confirmed on{' '}
              {state.chainName}.
            </Notice>
            <div
              style={{
                marginTop: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontSize: '13px',
              }}
            >
              {state.transactionHash ? (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ color: tokens.muted }}>Transaction</span>
                  <CopyableValue
                    value={state.transactionHash}
                    label='transaction hash'
                    explorerUrl={transactionExplorerUrl(
                      state.chainId,
                      state.transactionHash,
                    )}
                  />
                </div>
              ) : (
                <div style={{ color: tokens.muted }}>Transaction not reported</div>
              )}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ color: tokens.muted }}>User operation</span>
                <CopyableValue
                  value={state.userOperationHash}
                  label='user operation hash'
                />
              </div>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

const fieldLabel = {
  display: 'flex',
  flexDirection: 'column',
  fontSize: '12px',
  fontWeight: 600,
  color: tokens.muted,
} as const;

const fieldInput = {
  marginTop: '6px',
  height: '44px',
  width: '100%',
  border: `1px solid ${tokens.border}`,
  borderRadius: '10px',
  padding: '0 12px',
  fontSize: '14px',
  fontFamily: 'inherit',
  color: tokens.ink,
  background: '#fff',
  outline: 'none',
} as const;

const noticeSpacing = { marginTop: '14px' } as const;
