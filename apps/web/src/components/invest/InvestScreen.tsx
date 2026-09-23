'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChainChip } from '@/components/ui/ChainChip';
import { Modal } from '@/components/ui/Modal';
import { Notice } from '@/components/ui/Notice';
import { tokens } from '@/components/ui/tokens';
import { buildDeposit, type InvestPoolSummary } from '@/app/invest/actions';

/**
 * The Invest screen (D18 / EXE-014).
 *
 * Laid out to match the deployed baseline (`mvp.onchainisland.co`, Invest
 * screen): the instrument table, its columns, the footer note and the two stat
 * cards are the reference's. The instruments themselves are the reference's
 * demo list; only the Morpho pool is wired in this iteration.
 *
 * "Allocate" asks the server to build the deposit for the configured pool. The
 * server returns either a gated outcome (the pool, mainnet or signer is
 * missing) or the built calls. **Nothing is sent**: the Onchain gate is not
 * approved and the Safe WebAuthn signer is not deployed, so the dialog builds
 * and reports, and the screen says so plainly rather than implying a deposit
 * happened.
 */

export interface InvestScreenProps {
  /** The resolved pool, so the screen can name the configured market. */
  readonly pool: InvestPoolSummary;
  /** The resident Safe that would own the position, or null when none yet. */
  readonly safeAddress: string | null;
  /** Whether the Safe has been deployed on chain. */
  readonly safeDeployed: boolean;
  /** Whether the mainnet rail and the Safe signer are ready for execution. */
  readonly mainnetConfigured: boolean;
  readonly signerDeployed: boolean;
}

interface Instrument {
  readonly key: string;
  readonly name: string;
  readonly venue: string;
  readonly chain: string;
  readonly chainColor: string;
  readonly type: string;
  readonly terms: string;
  readonly minimum: string;
  /** Whether this iteration wires an execution path for the instrument. */
  readonly wired: boolean;
}

/**
 * The reference's instrument list, verbatim. `wired` marks the one instrument
 * this iteration has a call path for; the rest render as the baseline does.
 */
const INSTRUMENTS: readonly Instrument[] = [
  {
    key: 'aqua',
    name: 'Aqualectra 2025–2032 · AQUA-A1',
    venue: 'DCSX · feeder',
    type: 'Bond',
    terms: '5.00% semi-annual',
    minimum: '$2,800',
    chain: 'Ethereum',
    chainColor: '#627EEA',
    wired: false,
  },
  {
    key: 'soms',
    name: 'Staatsolie 2025–2033 · SOMS-25-A1',
    venue: 'DCSX',
    type: 'Bond',
    terms: 'USD · 7.75%',
    minimum: '$100',
    chain: 'Ethereum',
    chainColor: '#627EEA',
    wired: false,
  },
  {
    key: 'usdy',
    name: 'Ondo USDY',
    venue: 'Ondo · Arbitrum vault',
    type: 'Tokenized treasury',
    terms: '3.37% APY',
    minimum: '$500',
    chain: 'Arbitrum',
    chainColor: '#2D374B',
    wired: false,
  },
  {
    key: 'morpho',
    name: 'Morpho USDC vault · Base',
    venue: 'Morpho Blue · Base vault',
    type: 'Lending vault',
    terms: '4.62% APY · variable',
    minimum: '$100',
    chain: 'Base',
    chainColor: '#0052FF',
    wired: true,
  },
  {
    key: 'latam',
    name: 'LATAM EM Fund · Portfolio B',
    venue: 'DCSX',
    type: 'Fund',
    terms: 'Growth & fintech',
    minimum: '$10,000',
    chain: 'Ethereum',
    chainColor: '#627EEA',
    wired: false,
  },
];

type BuildState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'building' }
  | { readonly kind: 'not-wired' }
  | { readonly kind: 'gated'; readonly reason: string }
  | {
      readonly kind: 'built';
      readonly marketId: string;
      readonly amountUsdc: string;
      readonly calls: readonly { readonly to: string; readonly selector: string }[];
    };

const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;
const PRESETS = ['10000', '25000', '50000'] as const;

const GRID = '1.9fr .9fr 1fr 1.2fr .9fr .9fr 110px';

export function InvestScreen({
  pool,
  safeAddress,
  safeDeployed,
  mainnetConfigured,
  signerDeployed,
}: InvestScreenProps) {
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [amount, setAmount] = useState('25000');
  const [state, setState] = useState<BuildState>({ kind: 'idle' });

  const amountValid = AMOUNT_PATTERN.test(amount.trim()) && Number(amount) > 0;
  const canAllocate =
    selected !== null &&
    selected.wired &&
    pool.configured &&
    safeAddress !== null &&
    safeDeployed &&
    amountValid;

  function openInstrument(instrument: Instrument) {
    setSelected(instrument);
    setState({ kind: 'idle' });
    const min = Number(instrument.minimum.replace(/[^0-9]/g, ''));
    setAmount(String(Math.max(10000, Number.isFinite(min) ? min : 10000)));
  }

  function closeModal() {
    setSelected(null);
    setState({ kind: 'idle' });
  }

  async function allocate() {
    if (selected === null) return;
    if (!selected.wired) {
      setState({ kind: 'not-wired' });
      return;
    }
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
      <div style={{ marginBottom: '24px' }}>
        <h1
          style={{
            margin: 0,
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
            margin: '10px 0 0',
            color: tokens.muted,
            maxWidth: '62ch',
            textWrap: 'pretty',
          }}
        >
          Allocate from the vault into qualifying instruments on Ethereum, Base
          or Arbitrum. Allocations stay locked and keep counting toward your
          permit.
        </p>
      </div>

      {!pool.configured ? (
        <Notice tone="warning" title="Pool not configured">
          The Morpho pool address and market parameters are supplied by the
          project and are not present in this environment. Allocating cannot be
          built or executed until they are.
        </Notice>
      ) : null}

      <div
        style={{
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: '14px',
          overflow: 'hidden',
          marginBottom: '16px',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: '860px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: GRID,
                gap: '12px',
                padding: '12px 24px',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: tokens.muted,
                borderBottom: `1px solid ${tokens.border}`,
              }}
            >
              <span>Instrument</span>
              <span>Chain</span>
              <span>Type</span>
              <span>Yield / terms</span>
              <span>Minimum</span>
              <span>Qualifying</span>
              <span />
            </div>

            {INSTRUMENTS.map((instrument) => (
              <div
                key={instrument.key}
                style={{
                  display: 'grid',
                  gridTemplateColumns: GRID,
                  gap: '12px',
                  padding: '14px 24px',
                  fontSize: '13.5px',
                  borderBottom: `1px solid ${tokens.border}`,
                  alignItems: 'center',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{instrument.name}</div>
                  <div style={{ fontSize: '12px', color: tokens.muted }}>
                    {instrument.venue}
                  </div>
                </div>
                <ChainChip
                  name={instrument.chain}
                  color={instrument.chainColor}
                />
                <span style={{ color: tokens.muted, fontSize: '12.5px' }}>
                  {instrument.type}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {instrument.terms}
                </span>
                <span
                  style={{
                    color: tokens.muted,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {instrument.minimum}
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    color: tokens.success,
                  }}
                >
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: tokens.success,
                    }}
                  />
                  Yes
                </span>
                <button
                  type="button"
                  aria-label={`Allocate into ${instrument.name}`}
                  onClick={() => openInstrument(instrument)}
                  style={{
                    height: '32px',
                    border: 0,
                    borderRadius: '999px',
                    background: tokens.ink,
                    color: '#fff',
                    fontFamily: 'inherit',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Allocate
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '13px 24px', fontSize: '12.5px', color: tokens.muted }}>
          Allocations settle from vault USDC in one Safe transaction. Kade runs
          qualified vaults on Ethereum, Base and Arbitrum — the chain is chosen
          per instrument, and bridging is handled for you.
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
        }}
      >
        <Stat
          label="Vault USDC available"
          value="$0"
          note="Allocating does not change your qualifying balance."
        />
        <Stat
          label="Allocated this session"
          value="$0"
          note="0 instruments · shown in Holdings"
        />
      </div>

      <Modal
        open={selected !== null}
        onClose={closeModal}
        title={selected?.name ?? 'Allocate'}
        maxWidth={460}
      >
        {selected ? (
          <div style={{ fontSize: '13px', color: tokens.chipFg }}>
            <div style={{ fontSize: '12.5px', color: tokens.muted }}>
              {selected.venue} · {selected.chain} · {selected.type} ·{' '}
              {selected.terms} · min {selected.minimum}
            </div>

            {selected.wired ? (
              <>
                <label
                  htmlFor="invest-amount"
                  style={{
                    display: 'block',
                    marginTop: '14px',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
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
                  {PRESETS.map((preset) => (
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

                <dl style={{ margin: '14px 0 0', fontSize: '12.5px' }}>
                  <Row label="Pool chain" value={`Ethereum · ${pool.chainId}`} />
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

                <div style={{ marginTop: '16px' }}>
                  <Button
                    variant={canAllocate ? 'primary' : 'locked'}
                    disabled={!canAllocate || state.kind === 'building'}
                    onClick={allocate}
                    ariaLabel="Build the deposit"
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
                    {state.kind === 'building'
                      ? 'Building…'
                      : `Allocate ${amount} USDC`}
                  </Button>
                </div>
              </>
            ) : (
              <Notice tone="warning" title="Not wired yet">
                Only the Morpho pool is wired in this iteration. This instrument
                renders as the baseline does but has no execution path yet.
              </Notice>
            )}

            {state.kind === 'gated' ? (
              <Notice tone="warning" title="Deposit gated">
                {state.reason}
                <div style={{ marginTop: '6px' }}>
                  Nothing was signed or sent. The Morpho pool, mainnet and the
                  Safe WebAuthn signer deployment must be in place before a
                  deposit can execute.
                </div>
              </Notice>
            ) : null}

            {state.kind === 'built' ? (
              <Notice tone="info" title="Deposit built · not sent">
                The deposit is prepared as {state.calls.length} calls and{' '}
                <strong>nothing has been sent</strong>: execution is gated until
                the pool, mainnet and signer deployment are approved.
                <dl style={{ margin: '10px 0 0', fontSize: '13px' }}>
                  <Row label="Market id" value={state.marketId} mono />
                  <Row label="Amount" value={`${state.amountUsdc} USDC`} />
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
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <Card padding="22px 24px">
      <div
        style={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: tokens.muted,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '26px',
          fontWeight: 700,
          marginTop: '8px',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: '12.5px', color: tokens.muted, marginTop: '2px' }}>
        {note}
      </div>
    </Card>
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
