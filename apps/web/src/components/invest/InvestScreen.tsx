'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChainChip } from '@/components/ui/ChainChip';
import { Modal } from '@/components/ui/Modal';
import { Notice } from '@/components/ui/Notice';
import { tokens } from '@/components/ui/tokens';
import { beginDeposit, completeDeposit, type InvestVaultSummary } from '@/app/invest/actions';
import { promptPasskeyAssertionParts } from '@/lib/passkey/assertion';

/**
 * The Invest screen (D18 / EXE-014).
 *
 * Laid out to match the deployed baseline (`mvp.onchainisland.co`, Invest
 * screen): the instrument table, its columns, the footer note and the two stat
 * cards are the reference's. The instruments themselves are the reference's
 * demo list; only the MetaMorpho vault is wired in this iteration.
 *
 * "Allocate" runs the two-phase passkey flow: the server builds the deposit and
 * returns the SafeOp hash (`beginDeposit`), the browser signs it with the
 * resident's passkey (`promptPasskeyAssertionParts`), and the server submits the
 * retained operation and confirms the receipt (`completeDeposit`). Success is
 * reported only for a confirmed receipt; a gated build, a dismissed prompt and a
 * failed submission each report their own honest state.
 */

export interface InvestScreenProps {
  /** The resolved vault, so the screen can name the configured instrument. */
  readonly vault: InvestVaultSummary;
  /** The resident Safe that would own the position, or null when none yet. */
  readonly safeAddress: string | null;
  /** Whether the Safe has been deployed on chain. */
  readonly safeDeployed: boolean;
  /** Whether the mainnet rail (vault + RPC) is ready for execution. */
  readonly mainnetConfigured: boolean;
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
 * The reference's instrument list. The Morpho row's label and venue now name
 * the instrument accurately — a **MetaMorpho vault**, not a Morpho Blue market.
 * `wired` marks the one instrument this iteration has a call path for; the rest
 * render as the baseline does.
 *
 * The vault's row carries no yield figure: this build has no source for the
 * vault's current APY, so it is presented as unavailable rather than quoting the
 * reference's demo number as if it were real.
 */
const INSTRUMENTS: readonly Instrument[] = [
  {
    key: 'morpho',
    name: 'Morpho USDC vault',
    venue: 'MetaMorpho · Ethereum vault',
    type: 'Lending vault',
    terms: 'Variable APY · not quoted',
    minimum: '$100',
    chain: 'Ethereum',
    chainColor: '#627EEA',
    wired: true,
  },
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

type AllocateState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'building' }
  | { readonly kind: 'awaiting-passkey' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'not-wired' }
  | { readonly kind: 'gated'; readonly reason: string }
  | {
      readonly kind: 'failed';
      readonly stage: string;
      readonly reason: string;
      /** Whether the operation reached the bundler before the refusal. */
      readonly sent: boolean;
    }
  | {
      readonly kind: 'sent';
      readonly transactionHash: string | null;
      readonly userOperationHash: string;
      readonly amountUsdc: string;
    };

const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;
const PRESETS = ['10000', '25000', '50000'] as const;

const GRID = '1.9fr .9fr 1fr 1.2fr .9fr .9fr 110px';

/** A readable message from an unknown thrown value. */
function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function InvestScreen({
  vault,
  safeAddress,
  safeDeployed,
  mainnetConfigured,
}: InvestScreenProps) {
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [amount, setAmount] = useState('25000');
  const [state, setState] = useState<AllocateState>({ kind: 'idle' });

  const amountValid = AMOUNT_PATTERN.test(amount.trim()) && Number(amount) > 0;
  const canAllocate =
    selected !== null &&
    selected.wired &&
    vault.configured &&
    safeAddress !== null &&
    safeDeployed &&
    amountValid;
  const busy =
    state.kind === 'building' ||
    state.kind === 'awaiting-passkey' ||
    state.kind === 'submitting';

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

    const amountUsdc = amount.trim();

    // Phase 1: the server builds the operation (signs nothing) and returns the
    // SafeOp hash the passkey must sign.
    setState({ kind: 'building' });
    let begin;
    try {
      begin = await beginDeposit({
        safeAddress,
        amountUsdc,
        vaultConfigured: vault.configured,
        mainnetConfigured,
      });
    } catch (cause) {
      setState({ kind: 'failed', stage: 'build', reason: describeError(cause), sent: false });
      return;
    }

    if (begin.status === 'gated') {
      setState({ kind: 'gated', reason: begin.reason });
      return;
    }

    // The browser half: sign the server's hash with the resident's passkey.
    setState({ kind: 'awaiting-passkey' });
    let assertion;
    try {
      assertion = await promptPasskeyAssertionParts({
        credentialId: begin.credentialId,
        challenge: begin.hash,
        // The relying party is this page's own host, exactly as enrolment uses.
        rpId:
          typeof window === 'undefined' ? 'localhost' : window.location.hostname,
      });
    } catch (cause) {
      // A dismissed or failed prompt must say so rather than fall silently back
      // to the form.
      setState({ kind: 'failed', stage: 'passkey', reason: describeError(cause), sent: false });
      return;
    }

    // Phase 2: the server attaches the assertion and submits the retained op.
    setState({ kind: 'submitting' });
    let result;
    try {
      result = await completeDeposit({ token: begin.token, assertion });
    } catch (cause) {
      setState({ kind: 'failed', stage: 'submit', reason: describeError(cause), sent: false });
      return;
    }

    if (result.status === 'sent') {
      setState({
        kind: 'sent',
        transactionHash: result.transactionHash,
        userOperationHash: result.userOperationHash,
        amountUsdc,
      });
      return;
    }

    if (result.status === 'not-configured') {
      setState({ kind: 'gated', reason: result.reason });
      return;
    }

    setState({ kind: 'failed', stage: result.stage, reason: result.reason, sent: result.sent });
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
                  disabled={!instrument.wired}
                  title={
                    instrument.wired
                      ? undefined
                      : 'Only the MetaMorpho vault is wired in this iteration.'
                  }
                  style={{
                    height: '32px',
                    border: 0,
                    borderRadius: '999px',
                    background: instrument.wired ? tokens.ink : tokens.chipBg,
                    color: instrument.wired ? '#fff' : tokens.locked,
                    fontFamily: 'inherit',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: instrument.wired ? 'pointer' : 'not-allowed',
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
          <div
            style={{
              fontSize: '13px',
              color: tokens.chipFg,
              padding: '0 24px 24px',
            }}
          >
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
                  <Row label="Vault chain" value={`Ethereum · ${vault.chainId}`} />
                  <Row
                    label="MetaMorpho vault"
                    value={vault.vault ?? 'Not configured'}
                    mono={vault.vault !== null}
                  />
                  <Row
                    label="Underlying USDC"
                    value={vault.usdc ?? 'Not configured'}
                    mono={vault.usdc !== null}
                  />
                </dl>

                <div style={{ marginTop: '16px' }}>
                  <Button
                    variant={canAllocate ? 'primary' : 'locked'}
                    disabled={!canAllocate || busy}
                    onClick={allocate}
                    ariaLabel="Build the deposit"
                    title={
                      !vault.configured
                        ? 'Configure the MetaMorpho vault first'
                        : !safeDeployed || safeAddress === null
                          ? 'Your Safe must be deployed first'
                          : !amountValid
                            ? 'Enter a positive USDC amount'
                            : 'Build, sign and submit the deposit'
                    }
                  >
                    {state.kind === 'building'
                      ? 'Building…'
                      : state.kind === 'awaiting-passkey'
                        ? 'Confirm with your passkey…'
                        : state.kind === 'submitting'
                          ? 'Submitting…'
                          : `Allocate ${amount} USDC`}
                  </Button>
                </div>
              </>
            ) : (
              <Notice tone="warning" title="Not wired yet">
                Only the MetaMorpho vault is wired in this iteration. This
                instrument renders as the baseline does but has no execution path
                yet.
              </Notice>
            )}

            {state.kind === 'gated' ? (
              <Notice tone="warning" title="Deposit gated">
                {state.reason}
                <div style={{ marginTop: '6px' }}>Nothing was signed or sent.</div>
              </Notice>
            ) : null}

            {state.kind === 'awaiting-passkey' ? (
              <Notice tone="info" title="Awaiting your passkey">
                Confirm the deposit with your passkey to authorise the Safe
                transaction. The operation is built; nothing is sent until it is
                signed.
              </Notice>
            ) : null}

            {state.kind === 'submitting' ? (
              <Notice tone="info" title="Submitting">
                The signed operation is being submitted and its receipt confirmed.
              </Notice>
            ) : null}

            {state.kind === 'failed' ? (
              <Notice tone="error" title="Deposit failed">
                The deposit stopped at the <strong>{state.stage}</strong> step:{' '}
                {state.reason}
                <div style={{ marginTop: '6px' }}>
                  {state.sent
                    ? 'The operation reached the bundler but was not confirmed.'
                    : 'Nothing was sent.'}
                </div>
              </Notice>
            ) : null}

            {state.kind === 'sent' ? (
              <Notice tone="success" title="Deposit submitted">
                The deposit of {state.amountUsdc} USDC was submitted and its{' '}
                receipt confirmed.
                <dl style={{ margin: '10px 0 0', fontSize: '13px' }}>
                  <Row
                    label="Transaction"
                    value={state.transactionHash ?? 'Not reported'}
                    mono
                  />
                  <Row label="User operation" value={state.userOperationHash} mono />
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
      <span style={{ color: tokens.muted, flex: '0 0 auto' }}>{label}</span>
      <span
        style={{
          fontWeight: 600,
          minWidth: 0,
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
