'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Notice } from '@/components/ui/Notice';
import { tokens } from '@/components/ui/tokens';
import { buildDeposit, type InvestPoolSummary } from '@/app/invest/actions';

/**
 * The Invest screen for the one Morpho pool (D18 / EXE-014).
 *
 * The screen shows the single configured Ethereum-mainnet Morpho Blue market and
 * an amount control. "Allocate" asks the server to build the deposit; the server
 * returns either a gated outcome (the pool, mainnet or signer is missing) or the
 * built calls. **Nothing is sent**: the Onchain gate is not approved and the Safe
 * WebAuthn signer is not deployed, so the button builds and reports, and the
 * screen says so plainly rather than implying a deposit happened.
 *
 * The pool address, chain and market id are passed down as values from the
 * server page; this component hard-codes no address and no chain.
 */

export interface InvestScreenProps {
  /** The resolved pool, so the head of the screen can name the market. */
  readonly pool: InvestPoolSummary;
  /** The resident Safe that would own the position, or null when none yet. */
  readonly safeAddress: string | null;
  /** Whether the Safe has been deployed on chain. */
  readonly safeDeployed: boolean;
  /** Whether the mainnet rail and the Safe signer are ready for execution. */
  readonly mainnetConfigured: boolean;
  readonly signerDeployed: boolean;
}

type BuildState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'building' }
  | { readonly kind: 'gated'; readonly reason: string }
  | {
      readonly kind: 'built';
      readonly marketId: string;
      readonly amountUsdc: string;
      readonly calls: readonly { readonly to: string; readonly selector: string }[];
    };

const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;

function usdc(value: string): string {
  return `${value} USDC`;
}

export function InvestScreen({
  pool,
  safeAddress,
  safeDeployed,
  mainnetConfigured,
  signerDeployed,
}: InvestScreenProps) {
  const [amount, setAmount] = useState('25000');
  const [state, setState] = useState<BuildState>({ kind: 'idle' });

  const amountValid = AMOUNT_PATTERN.test(amount.trim()) && Number(amount) > 0;
  const canAllocate =
    pool.configured && safeAddress !== null && safeDeployed && amountValid;

  async function allocate() {
    if (!canAllocate || safeAddress === null) return;
    setState({ kind: 'building' });
    const result = await buildDeposit({
      safeAddress,
      amountUsdc: amount.trim(),
      poolConfigured: pool.configured,
      mainnetConfigured,
      signerDeployed,
    });
    if (result.status === 'gated') {
      setState({ kind: 'gated', reason: result.reason });
      return;
    }
    setState({
      kind: 'built',
      marketId: result.marketId,
      amountUsdc: result.amountUsdc,
      calls: result.calls,
    });
  }

  return (
    <div style={{ animation: 'fadeUp .2s ease-out' }}>
      <h1
        style={{
          margin: '0 0 6px',
          fontSize: '36px',
          lineHeight: 1.1,
          fontWeight: 700,
          letterSpacing: '-.02em',
        }}
      >
        Invest
      </h1>
      <p
        style={{
          margin: '0 0 24px',
          color: tokens.muted,
          maxWidth: '62ch',
          textWrap: 'pretty',
        }}
      >
        Allocate vault USDC into one Morpho market on Ethereum mainnet. The
        deposit is a single Safe transaction: an approval followed by the supply,
        signed once with your passkey.
      </p>

      <div style={{ display: 'grid', gap: '16px', maxWidth: '720px' }}>
        <Card padding="18px 20px">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '15px', fontWeight: 700 }}>
                Morpho Blue · USDC
              </div>
              <div style={{ fontSize: '12.5px', color: tokens.muted, marginTop: '2px' }}>
                Lending market · variable rate
              </div>
            </div>
            <Chip tone="brand" dot dotColor="#627EEA">
              Ethereum mainnet
            </Chip>
          </div>

          <dl style={{ margin: '14px 0 0', fontSize: '13px' }}>
            <Row label="Chain" value={`Ethereum · ${pool.chainId}`} />
            <Row
              label="Morpho"
              value={pool.morpho ?? 'Not configured'}
              mono={pool.morpho !== null}
            />
            <Row
              label="Loan token (USDC)"
              value={pool.loanToken ?? 'Not configured'}
              mono={pool.loanToken !== null}
            />
            <Row
              label="Market id"
              value={pool.marketId ?? 'Not configured'}
              mono={pool.marketId !== null}
            />
          </dl>
        </Card>

        {!pool.configured ? (
          <Notice tone="warning" title="Pool not configured">
            The Morpho pool address and market parameters are supplied by the
            project and are not present in this environment. The deposit cannot
            be built or executed until they are.
          </Notice>
        ) : null}

        <Card padding="18px 20px">
          <label
            htmlFor="invest-amount"
            style={{ fontSize: '13px', fontWeight: 600, color: tokens.chipFg }}
          >
            Amount to allocate (USDC)
          </label>
          <input
            id="invest-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            spellCheck={false}
            onChange={(event) => setAmount(event.target.value)}
            style={{
              marginTop: '8px',
              width: '100%',
              height: '48px',
              border: `1px solid ${tokens.border}`,
              borderRadius: '12px',
              padding: '0 14px',
              fontSize: '20px',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              fontFamily: 'inherit',
              background: '#fff',
              color: tokens.ink,
              outline: 'none',
            }}
          />
          <div
            style={{
              display: 'flex',
              gap: '8px',
              marginTop: '10px',
              flexWrap: 'wrap',
            }}
          >
            {['10000', '25000', '50000'].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(preset)}
                style={{
                  flex: '1 1 0',
                  minWidth: '80px',
                  height: '34px',
                  border: `1px solid ${tokens.border}`,
                  borderRadius: '999px',
                  fontFamily: 'inherit',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: amount === preset ? tokens.ink : '#fff',
                  color: amount === preset ? '#fff' : tokens.chipFg,
                }}
              >
                ${Number(preset) / 1000}k
              </button>
            ))}
          </div>

          <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
            <Button
              variant={canAllocate ? 'primary' : 'locked'}
              disabled={!canAllocate || state.kind === 'building'}
              onClick={allocate}
              title={
                !pool.configured
                  ? 'Configure the Morpho pool first'
                  : !safeDeployed || safeAddress === null
                    ? 'Your Safe must be deployed first'
                    : !amountValid
                      ? 'Enter a positive USDC amount'
                      : 'Build the deposit'
              }
            >
              {state.kind === 'building' ? 'Building…' : `Allocate ${usdc(amount)}`}
            </Button>
          </div>
        </Card>

        {state.kind === 'gated' ? (
          <Notice tone="warning" title="Deposit gated">
            {state.reason}
            <div style={{ marginTop: '6px' }}>
              Nothing was signed or sent. The Morpho pool, mainnet and the Safe
              WebAuthn signer deployment must be in place before a deposit can
              execute.
            </div>
          </Notice>
        ) : null}

        {state.kind === 'built' ? (
          <Notice tone="info" title="Deposit built · not sent">
            The deposit is prepared as {state.calls.length} calls and{' '}
            <strong>nothing has been sent</strong>: execution is gated until the
            pool, mainnet and signer deployment are approved.
            <dl style={{ margin: '10px 0 0', fontSize: '13px' }}>
              <Row label="Market id" value={state.marketId} mono />
              <Row label="Amount" value={usdc(state.amountUsdc)} />
              {state.calls.map((call, index) => (
                <Row
                  key={`${call.to}-${index}`}
                  label={index === 0 ? 'Call 1 · approve' : 'Call 2 · supply'}
                  value={`${call.to} · ${call.selector}`}
                  mono
                />
              ))}
            </dl>
          </Notice>
        ) : null}

        <p style={{ margin: 0, fontSize: '12.5px', color: tokens.muted, lineHeight: 1.6 }}>
          The allocation settles from vault USDC in one Safe transaction and stays
          locked for the permit term. Nothing on this screen sends a transaction
          yet: the deposit call path is built and configuration-gated.
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '7px 0',
        borderTop: `1px solid ${tokens.border}`,
      }}
    >
      <span style={{ color: tokens.muted }}>{label}</span>
      <span
        style={{
          fontWeight: 600,
          fontFamily: mono
            ? 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
            : undefined,
          wordBreak: 'break-all',
          textAlign: 'right',
        }}
      >
        {value}
      </span>
    </div>
  );
}
