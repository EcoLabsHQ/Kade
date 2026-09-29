'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChainChip } from '@/components/ui/ChainChip';
import { CopyableValue } from '@/components/ui/CopyableValue';
import { Modal } from '@/components/ui/Modal';
import { Notice } from '@/components/ui/Notice';
import { TransactionProgress } from '@/components/ui/TransactionProgress';
import { tokens } from '@/components/ui/tokens';
import {
  beginDeposit,
  beginWithdraw,
  completeDeposit,
  completeWithdraw,
  type InvestVaultSummary,
} from '@/app/invest/actions';
import { promptPasskeyAssertionParts } from '@/lib/passkey/assertion';
import { chainColor } from '@/lib/wealth/chain-colors';
import {
  addressExplorerUrl,
  transactionExplorerUrl,
} from '@/lib/wealth/explorer';

/**
 * The Invest screen (D18 / EXE-014).
 *
 * Laid out to match the deployed baseline (`mvp.onchainisland.co`, Invest
 * screen): the instrument table, its columns, the footer note and the two stat
 * cards are the reference's. The three MetaMorpho rails are wired in this
 * iteration — one investment per network; the other instruments render locked,
 * as the baseline does.
 *
 * "Allocate" runs the two-phase passkey flow: the server builds the deposit and
 * returns the SafeOp hash (`beginDeposit`), the browser signs it with the
 * resident's passkey (`promptPasskeyAssertionParts`), and the server submits the
 * retained operation and confirms the receipt (`completeDeposit`). Success is
 * reported only for a confirmed receipt; a gated build, a dismissed prompt and a
 * failed submission each report their own honest state.
 *
 * Each MetaMorpho rail is its own investment row, named with its chain: the
 * row the resident clicks is the chain the deposit is built for, shown before
 * signing and carried through `beginDeposit` / `completeDeposit`. The modal has
 * no chain selector, so the row's chain cannot be contradicted at signing time.
 *
 * The same row carries the inverse, **Un-allocate**: it runs the same two-phase
 * flow through `beginWithdraw` / `completeWithdraw` and a single ERC-4626
 * `withdraw` / `redeem` call built by the same server seam. The modal states,
 * before signing, that un-allocating lowers the qualified tier (the total the
 * app describes as the resident's tier across all three chains). "All" is the
 * default and redeems the whole share balance, so no dust is left behind.
 */

export interface InvestScreenProps {
  /**
   * The MetaMorpho rails, one summary per pinned chain (Ethereum, Base,
   * Arbitrum One).
   *
   * Each **configured** rail becomes its own investment row, named with its
   * chain, so the resident deposits into exactly the network they clicked
   * rather than choosing one in the modal. `configured` is a server-resolved
   * **UI hint** only: a rail that is not configured is not rendered as a
   * selectable investment. It is not a security gate — `beginDeposit` re-reads
   * the named chain's vault configuration and its own rail and refuses honestly
   * with a reason.
   */
  readonly vaults: readonly InvestVaultSummary[];
  /**
   * The resident Safe that would own the position, or null when none is yet
   * recorded.
   *
   * This is the recorded address alone. Whether it is deployed on the deposit
   * chain is read and verified server-side, and the first sponsored user
   * operation can deploy a counterfactual Safe, so the screen does not gate on
   * deployment state.
   */
  readonly safeAddress: string | null;
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
  /**
   * The rail chain a wired Morpho row deposits into, or `null` for an
   * instrument with no execution path. Carried by the row, so no separate
   * selector can point the deposit at a different chain than the row names.
   */
  readonly chainId: number | null;
}

/**
 * The one non-Morpho instrument this iteration renders. It has no execution
 * path and stays visibly locked, as the baseline does.
 *
 * The MetaMorpho rows are **not** here: they are derived at render from the
 * configured per-chain rails (see `morphoInstruments`), so the list cannot drift
 * from what can actually execute and an unconfigured rail never becomes
 * something a resident can click.
 */
const USDY_INSTRUMENT: Instrument = {
  key: 'usdy',
  name: 'Ondo USDY',
  venue: 'Ondo · Arbitrum vault',
  type: 'Tokenized treasury',
  terms: '3.37% APY',
  minimum: '$500',
  chain: 'Arbitrum',
  chainColor: '#2D374B',
  wired: false,
  chainId: null,
};

/**
 * One investment row per **configured** MetaMorpho rail, named with its chain.
 *
 * The rows come from the registry-derived `vaults` prop, in registry order
 * (Ethereum, Base, Arbitrum One), so the list is exactly the set of rails that
 * can execute. An unconfigured rail produces no row, and nothing to click.
 *
 * The vault's label and venue name the instrument accurately — a **MetaMorpho
 * vault**, not a Morpho Blue market. The row carries no yield figure: this build
 * has no source for the vault's current APY, so it is presented as unavailable
 * rather than quoting the reference's demo number as if it were real.
 */
function morphoInstruments(
  vaults: readonly InvestVaultSummary[],
): readonly Instrument[] {
  return vaults
    .filter((rail) => rail.configured)
    .map((rail) => ({
      key: `morpho-${rail.chainId}`,
      name: `Morpho USDC vault · ${rail.chainName}`,
      venue: 'MetaMorpho · USDC vault',
      type: 'Lending vault',
      terms: 'Variable APY · not quoted',
      minimum: '$100',
      chain: rail.chainName,
      chainColor: chainColor(rail.chainName),
      wired: true,
      chainId: rail.chainId,
    }));
}

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
      /** The chain the failed deposit was for, so the copy names it. */
      readonly chainName: string;
    }
  | {
      readonly kind: 'sent';
      readonly transactionHash: string | null;
      readonly userOperationHash: string;
      readonly amountUsdc: string;
      /** The chain the confirmed deposit landed on. */
      readonly chainId: number;
      readonly chainName: string;
      /** The MetaMorpho vault the confirmed deposit targeted, for the link. */
      readonly vault: string | null;
    };

const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;
const PRESETS = ['10000', '25000', '50000'] as const;

const GRID = '1.9fr .9fr 1fr 1.2fr .9fr .9fr 210px';

/** Which direction the open modal is running. */
type Direction = 'allocate' | 'unallocate';

/** A readable message from an unknown thrown value. */
function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function InvestScreen({ vaults, safeAddress }: InvestScreenProps) {
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [direction, setDirection] = useState<Direction>('allocate');
  const [amount, setAmount] = useState('25000');
  // For an un-allocate, "all" redeems the whole share balance (no dust). It
  // defaults on when the un-allocate modal opens.
  const [withdrawAll, setWithdrawAll] = useState(false);
  const [state, setState] = useState<AllocateState>({ kind: 'idle' });

  // The rail a Morpho row deposits into, resolved from the row's own chain id —
  // never a separate selection, so the row's chain and the deposit's chain
  // cannot disagree. Null for a non-Morpho row (no rail) or a row whose chain is
  // no longer among the configured rails.
  const selectedRail =
    selected?.chainId != null
      ? (vaults.find((rail) => rail.chainId === selected.chainId) ?? null)
      : null;

  const amountValid = AMOUNT_PATTERN.test(amount.trim()) && Number(amount) > 0;
  // The client precondition is deliberately shallow and is not a security gate:
  // `beginDeposit` resolves every gate server-side (the named chain's vault, its
  // own rail and the Safe's state on that chain) and refuses honestly with a
  // reason. In particular there is no deployment requirement: a recorded Safe
  // that is not yet deployed on the deposit chain can still start a deposit,
  // because its first sponsored user operation deploys it.
  const canAllocate =
    selected !== null &&
    selected.wired &&
    selectedRail !== null &&
    selectedRail.configured &&
    safeAddress !== null &&
    amountValid;
  // The inverse precondition. "All" needs no amount; a partial needs the same
  // shallow USDC check as the deposit. As with the deposit, this is not a
  // security gate: `beginWithdraw` re-reads the named chain's vault and rail and
  // pre-flights the Safe's actual share balance server-side.
  const canWithdraw =
    selected !== null &&
    selected.wired &&
    selectedRail !== null &&
    selectedRail.configured &&
    safeAddress !== null &&
    (withdrawAll || amountValid);
  const canTransact = direction === 'unallocate' ? canWithdraw : canAllocate;
  const busy =
    state.kind === 'building' ||
    state.kind === 'awaiting-passkey' ||
    state.kind === 'submitting';

  function openInstrument(
    instrument: Instrument,
    nextDirection: Direction = 'allocate',
  ) {
    setSelected(instrument);
    setDirection(nextDirection);
    setState({ kind: 'idle' });
    const min = Number(instrument.minimum.replace(/[^0-9]/g, ''));
    setAmount(String(Math.max(10000, Number.isFinite(min) ? min : 10000)));
    // An un-allocate defaults to the whole position so `redeem` leaves no dust
    // share that could not later be withdrawn.
    setWithdrawAll(nextDirection === 'unallocate');
  }

  function closeModal() {
    setSelected(null);
    setDirection('allocate');
    setWithdrawAll(false);
    setState({ kind: 'idle' });
  }

  async function runTransaction(kind: Direction) {
    if (selected === null) return;
    if (!selected.wired) {
      setState({ kind: 'not-wired' });
      return;
    }
    const canRun = kind === 'unallocate' ? canWithdraw : canAllocate;
    if (!canRun || safeAddress === null || selectedRail === null) return;

    const chainName = selectedRail.chainName;
    // The amount the success copy reports: "all" for a full redemption, the
    // typed figure for a partial. The server resolves the exact shares for
    // "all"; the client never fabricates a share or USDC figure.
    const amountUsdc =
      kind === 'unallocate' && withdrawAll ? 'all' : amount.trim();

    // Phase 1: the server builds the operation (signs nothing) for the named
    // chain and returns the SafeOp hash the passkey must sign. A deposit and an
    // un-allocate go through the same two server actions' seam.
    setState({ kind: 'building' });
    let begin;
    try {
      // Gate state is not sent: the server resolves the named chain's vault and
      // rail (and, for an un-allocate, pre-flights the Safe's shares) itself, so
      // the caller cannot turn a gate off.
      begin =
        kind === 'allocate'
          ? await beginDeposit({
              safeAddress,
              amountUsdc: amount.trim(),
              chainId: selectedRail.chainId,
            })
          : await beginWithdraw({
              safeAddress,
              amount: withdrawAll
                ? { kind: 'all' }
                : { kind: 'partial', amountUsdc: amount.trim() },
              chainId: selectedRail.chainId,
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

    // The browser half: sign the server's hash with the resident's passkey.
    setState({ kind: 'awaiting-passkey' });
    let assertion;
    try {
      assertion = await promptPasskeyAssertionParts({
        credentialId: begin.credentialId,
        challenge: begin.hash,
        // The relying party is this page's own host, exactly as enrolment uses.
        rpId:
          typeof window === 'undefined'
            ? 'localhost'
            : window.location.hostname,
      });
    } catch (cause) {
      // A dismissed or failed prompt must say so rather than fall silently back
      // to the form.
      setState({
        kind: 'failed',
        stage: 'passkey',
        reason: describeError(cause),
        sent: false,
        chainName,
      });
      return;
    }

    // Phase 2: the server attaches the assertion and submits the retained op on
    // the chain the server built it for (from the build response, not the UI).
    const builtChainId = begin.chainId;
    const builtChainName =
      vaults.find((rail) => rail.chainId === builtChainId)?.chainName ??
      chainName;
    setState({ kind: 'submitting' });
    let result;
    try {
      result =
        kind === 'allocate'
          ? await completeDeposit({
              token: begin.token,
              assertion,
              chainId: builtChainId,
            })
          : await completeWithdraw({
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
        amountUsdc,
        chainId: builtChainId,
        chainName: builtChainName,
        // The vault the built operation targeted, from the same rail the server
        // built for — not a re-selected UI value.
        vault:
          vaults.find((rail) => rail.chainId === builtChainId)?.vault ?? null,
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

  // The configured MetaMorpho rails become one row each, named with their own
  // chain, followed by the one instrument that has no execution path.
  const instruments = [...morphoInstruments(vaults), USDY_INSTRUMENT];

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

            {instruments.map((instrument) => (
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
                <div
                  style={{
                    display: 'flex',
                    gap: '6px',
                    justifyContent: 'flex-end',
                  }}
                >
                  <button
                    type='button'
                    aria-label={`Allocate into ${instrument.name}`}
                    onClick={() => openInstrument(instrument, 'allocate')}
                    disabled={!instrument.wired}
                    title={
                      instrument.wired
                        ? undefined
                        : 'Only the MetaMorpho vaults are wired in this iteration.'
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
                  <button
                    type='button'
                    aria-label={`Un-allocate from ${instrument.name}`}
                    onClick={() => openInstrument(instrument, 'unallocate')}
                    disabled={!instrument.wired}
                    title={
                      instrument.wired
                        ? 'Redeem USDC from this chain’s MetaMorpho vault'
                        : 'Only the MetaMorpho vaults are wired in this iteration.'
                    }
                    style={{
                      height: '32px',
                      border: `1px solid ${tokens.border}`,
                      borderRadius: '999px',
                      background: '#fff',
                      color: instrument.wired ? tokens.chipFg : tokens.locked,
                      fontFamily: 'inherit',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: instrument.wired ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Un-allocate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            padding: '13px 24px',
            fontSize: '12.5px',
            color: tokens.muted,
          }}
        >
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
          label='Vault USDC available'
          value='$0'
          note='Allocating does not change your qualifying balance.'
        />
        <Stat
          label='Allocated this session'
          value='$0'
          note='0 instruments · shown in Holdings'
        />
      </div>

      <Modal
        open={selected !== null}
        onClose={closeModal}
        title={
          selected
            ? direction === 'unallocate'
              ? `Un-allocate from ${selected.name}`
              : selected.name
            : 'Allocate'
        }
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
                <div style={{ marginTop: '14px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>
                    {direction === 'unallocate' ? 'Redemption chain' : 'Deposit chain'}
                  </div>
                  <div
                    style={{
                      marginTop: '6px',
                      fontSize: '12.5px',
                      color: tokens.muted,
                    }}
                  >
                    {direction === 'unallocate'
                      ? 'This investment redeems from '
                      : 'This investment deposits on '}
                    <strong style={{ color: tokens.chipFg }}>
                      {selected.chain}
                    </strong>
                    {selectedRail ? ` · chain ${selectedRail.chainId}` : ''}. The
                    chain is set by the investment you chose, not selected at
                    signing time.
                  </div>
                </div>

                <label
                  htmlFor='invest-amount'
                  style={{
                    display: 'block',
                    marginTop: '14px',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  {direction === 'unallocate'
                    ? 'Amount to un-allocate (USDC)'
                    : 'Amount to allocate (USDC)'}
                </label>
                <input
                  id='invest-amount'
                  type='text'
                  inputMode='decimal'
                  value={amount}
                  spellCheck={false}
                  disabled={direction === 'unallocate' && withdrawAll}
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
                    background: direction === 'unallocate' && withdrawAll ? tokens.chipBg : '#fff',
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
                      type='button'
                      onClick={() => {
                        setAmount(preset);
                        // A preset is a stated amount, so it clears "all".
                        if (direction === 'unallocate') setWithdrawAll(false);
                      }}
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

                {direction === 'unallocate' ? (
                  <label
                    htmlFor='invest-withdraw-all'
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginTop: '12px',
                      fontSize: '12.5px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      id='invest-withdraw-all'
                      type='checkbox'
                      checked={withdrawAll}
                      onChange={(event) => setWithdrawAll(event.target.checked)}
                    />
                    Un-allocate everything on {selected.chain} (redeem all shares)
                  </label>
                ) : null}

                <dl style={{ margin: '14px 0 0', fontSize: '12.5px' }}>
                  <Row
                    label='Vault chain'
                    value={
                      selectedRail
                        ? `${selectedRail.chainName} · ${selectedRail.chainId}`
                        : 'Not configured'
                    }
                  />
                  <Row
                    label='MetaMorpho vault'
                    value={selectedRail?.vault ?? 'Not configured'}
                    mono={selectedRail?.vault != null}
                  />
                  <Row
                    label='Underlying USDC'
                    value={selectedRail?.usdc ?? 'Not configured'}
                    mono={selectedRail?.usdc != null}
                  />
                </dl>

                {direction === 'unallocate' ? (
                  <div
                    data-testid='invest-unallocate-tier-warning'
                    style={{ marginTop: '16px' }}
                  >
                    <Notice tone='warning' title='This lowers your qualified tier'>
                      Un-allocating reduces the total the app describes as your
                      tier — your tier is the total across all three chains.
                      Withdrawing lowers that total and can start the 90-day cure
                      period. Shown before you sign.
                    </Notice>
                  </div>
                ) : null}

                <div style={{ marginTop: '16px', marginBottom: '16px'}}>
                  <Button
                    style={{ width: '100%' }}
                    variant={canTransact ? 'primary' : 'locked'}
                    disabled={!canTransact || busy}
                    onClick={() => runTransaction(direction)}
                    ariaLabel={
                      direction === 'unallocate'
                        ? 'Build the un-allocate'
                        : 'Build the deposit'
                    }
                    title={
                      selectedRail === null
                        ? 'No MetaMorpho vault rail is configured on any chain'
                        : !selectedRail.configured
                          ? `The ${selectedRail.chainName} vault rail is not configured`
                          : safeAddress === null
                            ? 'No Safe is recorded for this account yet'
                            : direction === 'unallocate'
                              ? withdrawAll
                                ? 'Build, sign and submit the un-allocate of the full position'
                                : !amountValid
                                  ? 'Enter a positive USDC amount'
                                  : 'Build, sign and submit the un-allocate'
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
                          : direction === 'unallocate'
                            ? withdrawAll
                              ? 'Un-allocate all USDC'
                              : `Un-allocate ${amount} USDC`
                            : `Allocate ${amount} USDC`}
                  </Button>
                </div>
              </>
            ) : (
              <Notice tone='warning' title='Not wired yet'>
                Only the MetaMorpho vaults are wired in this iteration. This
                instrument renders as the baseline does but has no execution
                path yet.
              </Notice>
            )}

            {state.kind === 'gated' ? (
              <Notice
                tone='warning'
                title={
                  direction === 'unallocate'
                    ? 'Un-allocate gated'
                    : 'Deposit gated'
                }
              >
                {state.reason}
                <div style={{ marginTop: '6px' }}>
                  Nothing was signed or sent.
                </div>
              </Notice>
            ) : null}

            {state.kind === 'building' ? (
              <TransactionProgress
                label={
                  direction === 'unallocate'
                    ? 'Building the un-allocate…'
                    : 'Building the deposit…'
                }
                progressLabel={
                  direction === 'unallocate'
                    ? 'Building the un-allocate'
                    : 'Building the deposit'
                }
              />
            ) : null}

            {state.kind === 'awaiting-passkey' ? (
              <TransactionProgress
                label={
                  direction === 'unallocate'
                    ? 'Waiting for your passkey to authorise the un-allocate…'
                    : 'Waiting for your passkey to authorise the deposit…'
                }
                progressLabel='Awaiting your passkey'
              />
            ) : null}

            {state.kind === 'submitting' ? (
              <TransactionProgress
                label={`Submitting and confirming the ${
                  direction === 'unallocate' ? 'un-allocate' : 'deposit'
                } on ${selectedRail?.chainName ?? ''}…`}
                progressLabel={
                  direction === 'unallocate'
                    ? 'Confirming the un-allocate'
                    : 'Confirming the deposit'
                }
              />
            ) : null}

            {state.kind === 'failed' ? (
              <Notice
                tone='error'
                title={
                  direction === 'unallocate'
                    ? 'Un-allocate failed'
                    : 'Deposit failed'
                }
              >
                The {direction === 'unallocate' ? 'un-allocate' : 'deposit'} on{' '}
                {state.chainName} stopped at the <strong>{state.stage}</strong>{' '}
                step: {state.reason}
                <div style={{ marginTop: '6px' }}>
                  {state.sent
                    ? 'The operation reached the bundler but was not confirmed.'
                    : 'Nothing was sent.'}
                </div>
              </Notice>
            ) : null}

            {state.kind === 'sent' ? (
              <div
                data-testid={
                  direction === 'unallocate'
                    ? 'invest-unallocate-complete'
                    : 'invest-deposit-complete'
                }
                style={{ marginTop: '14px' }}
              >
                <Notice
                  tone='success'
                  title={
                    direction === 'unallocate'
                      ? 'Un-allocate submitted'
                      : 'Deposit submitted'
                  }
                >
                  {direction === 'unallocate'
                    ? `The un-allocate of ${
                        state.amountUsdc === 'all'
                          ? 'the full position'
                          : `${state.amountUsdc} USDC`
                      } was submitted and its receipt confirmed on ${state.chainName}.`
                    : `The deposit of ${state.amountUsdc} USDC was submitted and its receipt confirmed on ${state.chainName}.`}
                </Notice>
                <dl style={{ margin: '12px 0 0', fontSize: '13px' }}>
                  <Detail label='Transaction'>
                    {state.transactionHash ? (
                      <CopyableValue
                        value={state.transactionHash}
                        label='transaction hash'
                        explorerUrl={transactionExplorerUrl(
                          state.chainId,
                          state.transactionHash,
                        )}
                      />
                    ) : (
                      <span style={{ color: tokens.muted }}>Not reported</span>
                    )}
                  </Detail>
                  <Detail label='User operation'>
                    <CopyableValue
                      value={state.userOperationHash}
                      label='user operation hash'
                    />
                  </Detail>
                  {state.vault ? (
                    <Detail label='MetaMorpho vault'>
                      <CopyableValue
                        value={state.vault}
                        label='MetaMorpho vault address'
                        explorerUrl={addressExplorerUrl(
                          state.chainId,
                          state.vault,
                        )}
                      />
                    </Detail>
                  ) : null}
                  {safeAddress ? (
                    <Detail label='Your Safe'>
                      <CopyableValue
                        value={safeAddress}
                        label='Safe address'
                        explorerUrl={addressExplorerUrl(
                          state.chainId,
                          safeAddress,
                        )}
                      />
                    </Detail>
                  ) : null}
                </dl>
              </div>
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
    <Card padding='22px 24px'>
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
      <div
        style={{ fontSize: '12.5px', color: tokens.muted, marginTop: '2px' }}
      >
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

/**
 * A labelled detail line whose value is already-rendered node — used for the
 * finish state, where an address or hash is a copyable, linked control rather
 * than a plain string.
 */
function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: '12px',
        padding: '7px 0',
        borderTop: `1px solid ${tokens.border}`,
      }}
    >
      <span style={{ color: tokens.muted, flex: '0 0 auto' }}>{label}</span>
      <span style={{ minWidth: 0, textAlign: 'right' }}>{children}</span>
    </div>
  );
}
