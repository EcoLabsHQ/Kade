'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChainChip } from '@/components/ui/ChainChip';
import { CopyableValue } from '@/components/ui/CopyableValue';
import { Modal } from '@/components/ui/Modal';
import { Notice } from '@/components/ui/Notice';
import { TransactionProgress } from '@/components/ui/TransactionProgress';
import { tokens } from '@/components/ui/tokens';
import { PositionMenu } from '@/components/invest/PositionMenu';
import {
  beginDeposit,
  beginWithdraw,
  completeDeposit,
  completeWithdraw,
  type InvestVaultSummary,
} from '@/app/invest/actions';
import { promptPasskeyAssertionParts } from '@/lib/passkey/assertion';
import { summarizeInvestPosition } from '@/lib/invest/invest-position';
import {
  defaultAllocationUsdc,
  minimumAllocationLabel,
} from '@/lib/invest/allocation-minimum';
import {
  isMorphoYieldReadable,
  type MorphoYieldRead,
} from '@/lib/invest/morpho-yield';
import { chainColor } from '@/lib/wealth/chain-colors';
import {
  addressExplorerUrl,
  transactionExplorerUrl,
} from '@/lib/wealth/explorer';
import { usd, usd2 } from '@/lib/wealth/format';
import {
  summarizeQualifiedPosition,
  type QualifiedPosition,
} from '@/lib/wealth/qualified-position';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';

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
 *
 * The resident's **real position** comes from one read the route performs with
 * `loadVaultHoldings` — the same on-chain reader Holdings uses — and is passed
 * in as `holdings`. The screen reduces it once (see `summarizeInvestPosition`)
 * and derives everything from it: the two stat cards, each row's state (the
 * real held amount, or `Allocate` when it holds nothing) and the allocate
 * preview. No figure is hardcoded and no failed read becomes a `$0`; a failure
 * keeps its specific reason.
 *
 * Each row shows **one thing**, and the amount is the control: a row with no
 * position carries a single `Allocate` button, and a row that holds a position
 * carries the real held amount as a trigger whose menu holds both directions
 * (`Allocate more` / `Un-allocate`). An unread position keeps its honest state
 * as the trigger and opens the same menu, so the withdraw path can never become
 * unreachable just because a read failed. See {@link PositionMenu}.
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
  /**
   * The Safe's on-chain qualified holdings, read **once** by the route through
   * {@link loadVaultHoldings} and used here as the single source of truth for
   * the two stat cards, each row's state (empty vs the real held amount) and
   * the allocate preview. It is the same reader the Holdings screen uses, so
   * there is no second position read and nothing is stored.
   *
   * The rows carry their own failures: an unread chain stays visible with its
   * reason and never becomes a zero.
   */
  readonly holdings: readonly VaultHoldingRow[];
  /**
   * The Safe's **qualified** total, produced once by the route with
   * {@link summarizeQualifiedPosition} from the same `holdings` rows. This is
   * the native-inclusive total — native coin + USDC + MetaMorpho allocations —
   * and it is the **same** reduction the Holdings `QUALIFIED` card and the
   * residency tier check consume, so Invest and Holdings cannot disagree. When
   * omitted the screen reduces `holdings` with the same function, so a bare
   * render stays consistent.
   *
   * It is deliberately separate from {@link summarizeInvestPosition}, which
   * stays USDC/Morpho only: native coin counts toward the qualified total but is
   * **not** an Invest instrument and cannot be allocated.
   */
  readonly qualified?: QualifiedPosition;
  /**
   * Each pinned rail's current yield, read **once** by the route from Morpho's
   * public API through {@link readMorphoVaultYield} and keyed by chain id.
   *
   * This is the source the allocate modal's **Estimated income** line uses. It
   * is passed in rather than fetched in the component so the render stays
   * offline and deterministic, and so the read is the route's one bounded,
   * cached call (Next revalidation) rather than a per-render one. A chain whose
   * read failed is either absent or carries its own `unknown` reason, so the
   * line says **why** it cannot quote a figure instead of inventing one.
   */
  readonly yields?: ReadonlyMap<number, MorphoYieldRead>;
}

interface Instrument {
  readonly key: string;
  readonly name: string;
  readonly venue: string;
  readonly chain: string;
  readonly chainColor: string;
  readonly type: string;
  readonly terms: string;
  /**
   * The instrument's own minimum, as a display string. For the wired
   * MetaMorpho rails this is {@link minimumAllocationLabel} — the one source of
   * truth (`$1`) shared with the modal's summary box — so the column and the
   * summary cannot state different minimums.
   */
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
 *
 * Its `$500` minimum is the reference's own locked-instrument figure and is a
 * **different instrument** from the wired rails, so it is not the shared
 * allocation minimum; only the wired MetaMorpho rails derive theirs from
 * {@link minimumAllocationLabel}.
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
 * vault**, not a Morpho Blue market. The row carries no yield figure: the table
 * has no place for the vault's live APY, so it is presented as unavailable
 * rather than quoting the reference's demo number as if it were real. (The
 * modal's **Estimated income** line is the surface that quotes a live figure,
 * from Morpho, and it is the only one.)
 *
 * `minimum` is the owner's flat `$1` floor, from the one source of truth, so the
 * checklist column and the summary box state the same figure.
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
      minimum: minimumAllocationLabel(),
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

// The last column is the reference's own 110px (kade-mvp.dc.html, the Invest
// table). It was widened to 210px when the row briefly carried two controls;
// the row now carries one, so the extra width was dead space. The single
// control is right-aligned and lays out at its natural width, so a long state
// (`Position unread`) can bleed only into the free inter-column gutter and is
// never truncated or clipped. See `PositionMenu`.
const GRID = '1.9fr .9fr 1fr 1.2fr .9fr .9fr 110px';

/** Which direction the open modal is running. */
type Direction = 'allocate' | 'unallocate';

/** A readable message from an unknown thrown value. */
function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function InvestScreen({
  vaults,
  safeAddress,
  holdings,
  qualified,
  yields,
}: InvestScreenProps) {
  // The one position read, reduced for the whole screen: the stat cards, each
  // row's state and the allocate preview all come from these same rows, so the
  // screen cannot show two different versions of the resident's position.
  const position = summarizeInvestPosition({ holdings, safeAddress, vaults });

  // The one **qualified** total, over the same rows: the route computes it with
  // `summarizeQualifiedPosition` and passes it in, so Invest reads the exact
  // value Holdings and the residency tier check consume. A bare render (no prop)
  // still reduces the same rows with the same function, so the two can never
  // disagree. This is native-inclusive; it is not the Invest position and does
  // not make native coin allocatable.
  const qualifiedPosition =
    qualified ??
    summarizeQualifiedPosition({ safeAddress, rows: holdings });

  // The App Router router, used **once per completed operation** to re-read the
  // route's server data (the Safe's position) after a confirmed receipt. The
  // route is `force-dynamic`, so a refresh re-runs its on-chain read and the
  // stat cards and rows update without a manual reload.
  const router = useRouter();

  const [selected, setSelected] = useState<Instrument | null>(null);
  const [direction, setDirection] = useState<Direction>('allocate');
  const [amount, setAmount] = useState('25000');
  // For an un-allocate, "all" redeems the whole share balance (no dust). It
  // defaults on when the un-allocate modal opens.
  const [withdrawAll, setWithdrawAll] = useState(false);
  const [state, setState] = useState<AllocateState>({ kind: 'idle' });
  // The contract-address block is collapsed behind a disclosure so it does not
  // dominate the modal. It resets to collapsed each time a modal opens.
  const [contractsOpen, setContractsOpen] = useState(false);
  const contractDetailsId = useId();
  // The confirmed-transaction detail block (the hashes and addresses) is folded
  // away the same way, so the success notice is not buried under four rows of
  // hex. It resets to collapsed for every fresh finish.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();

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
    setContractsOpen(false);
    setDetailsOpen(false);
    setAmount(String(defaultAllocationUsdc()));
    // An un-allocate defaults to the whole position so `redeem` leaves no dust
    // share that could not later be withdrawn.
    setWithdrawAll(nextDirection === 'unallocate');
  }

  function closeModal() {
    setSelected(null);
    setDirection('allocate');
    setWithdrawAll(false);
    setContractsOpen(false);
    setDetailsOpen(false);
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

    // A fresh finish must not inherit a previously-opened detail panel.
    setDetailsOpen(false);

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
      // The receipt is confirmed, so re-read the route's position exactly once
      // for this completed operation. It is called here (not in a render or an
      // effect) so it fires once per confirmed deposit/un-allocate and never on
      // a re-render.
      router.refresh();
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

  // The allocate preview's "Vault USDC after": the deposit draws from the row's
  // own chain, so the figure is that chain's free USDC less the amount. When
  // the chain's read failed or the amount exceeds it, the preview says so
  // (unknown / not enough) rather than showing an invented balance.
  const selectedChainFree =
    selected?.chainId != null
      ? (position.freeByChain.get(selected.chainId) ?? null)
      : null;
  const amountNumber = amountValid ? Number(amount.trim()) : null;
  const vaultAfter = ((): {
    readonly value: string;
    readonly title: string | undefined;
    readonly muted: boolean;
  } => {
    if (!selectedChainFree) {
      return {
        value: '—',
        title: 'This vault rail is not configured, so its USDC cannot be previewed.',
        muted: true,
      };
    }
    if (selectedChainFree.status === 'unknown') {
      return { value: '—', title: selectedChainFree.reason, muted: true };
    }
    if (amountNumber === null) {
      return {
        value: '—',
        title: 'Enter a positive USDC amount to preview the vault USDC after.',
        muted: true,
      };
    }
    if (amountNumber > selectedChainFree.usd) {
      return {
        value: '—',
        title:
          `The Safe holds ${usd(selectedChainFree.usd)} free USDC on ` +
          `${selected?.chain ?? 'this chain'}, less than the ` +
          `${usd(amountNumber)} to allocate.`,
        muted: true,
      };
    }
    return {
      value: usd(selectedChainFree.usd - amountNumber),
      title: undefined,
      muted: false,
    };
  })();

  // The allocate modal's **Estimated income**: the amount the resident typed
  // times the vault's yield read from Morpho, shown as the reference does
  // (`$500 / yr est.`). The rate comes from the injected per-chain read, never
  // from the design's demo number; when that read failed or the rail is
  // unconfigured, the line returns `Not quoted` with the specific reason, and
  // never a zero or a guessed figure. A genuine `0` rate yields a real `$0`.
  const selectedYield =
    selected?.chainId != null ? (yields?.get(selected.chainId) ?? null) : null;
  const estimatedIncome = ((): {
    readonly value: string;
    readonly title: string | undefined;
    readonly muted: boolean;
  } => {
    if (!isMorphoYieldReadable(selectedYield)) {
      return {
        value: 'Not quoted',
        title:
          selectedYield?.status === 'unknown'
            ? selectedYield.reason
            : 'No Morpho yield is available for this vault, so no income can be estimated.',
        muted: true,
      };
    }
    if (amountNumber === null) {
      return {
        value: 'Not quoted',
        title: 'Enter a positive USDC amount to estimate income.',
        muted: true,
      };
    }
    return {
      value: `${usd(amountNumber * selectedYield.netApy)} / yr est.`,
      title: undefined,
      muted: false,
    };
  })();

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

            {instruments.map((instrument) => {
              // The real state of the resident's position on this row's chain,
              // from the one position read. `null` for the unwired instrument,
              // which has no chain to be read on.
              const chainPosition =
                instrument.chainId !== null
                  ? (position.byChain.get(instrument.chainId) ?? null)
                  : null;
              return (
              <div
                key={instrument.key}
                data-testid={`invest-row-${instrument.key}`}
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
                {/*
                  One thing per row, and the amount is the control. A held
                  position renders the real amount as a trigger whose menu holds
                  both directions; an unread read renders its honest state as
                  the trigger and opens the same menu, so the withdraw path is
                  never the state that gets dropped. A row with no position
                  renders the single `Allocate` button. The trigger's own menu
                  (see `PositionMenu`) carries `Allocate more` / `Un-allocate`
                  in every state that has a position.
                */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    minWidth: 0,
                  }}
                >
                  {chainPosition?.status === 'held' ? (
                    <PositionMenu
                      instrumentName={instrument.name}
                      testId={`invest-held-${instrument.chainId}`}
                      label={`${usd(chainPosition.usd)} held`}
                      title={`The Safe holds ${usd(chainPosition.usd)} in this vault.`}
                      hasPosition
                      variant='held'
                      onAllocate={() => openInstrument(instrument, 'allocate')}
                      onUnallocate={() =>
                        openInstrument(instrument, 'unallocate')
                      }
                    />
                  ) : chainPosition?.status === 'unknown' ? (
                    // The read failed: the row shows that the state is unknown
                    // (with the real reason on hover), never a fabricated $0 —
                    // and it still opens the menu, so un-allocate stays
                    // reachable even when the position could not be read.
                    <PositionMenu
                      instrumentName={instrument.name}
                      testId={`invest-position-unknown-${instrument.chainId}`}
                      label='Position unread'
                      title={chainPosition.reason}
                      hasPosition={false}
                      variant='unknown'
                      onAllocate={() => openInstrument(instrument, 'allocate')}
                      onUnallocate={() =>
                        openInstrument(instrument, 'unallocate')
                      }
                    />
                  ) : (
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
                        padding: '0 14px',
                        border: 0,
                        borderRadius: '999px',
                        background: instrument.wired ? tokens.ink : tokens.chipBg,
                        color: instrument.wired ? '#fff' : tokens.locked,
                        fontFamily: 'inherit',
                        fontSize: '12px',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        cursor: instrument.wired ? 'pointer' : 'not-allowed',
                      }}
                    >
                      Allocate
                    </button>
                  )}
                </div>
              </div>
              );
            })}
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
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: '16px',
        }}
      >
        {/*
          The qualified total, native-inclusive. It is the **same** reduction the
          Holdings `QUALIFIED` card and the residency tier check consume, so the
          two screens render the identical figure. It is shown here so a resident
          whose Safe holds native ETH sees that value count toward their permit
          rather than vanishing from Invest. It is deliberately distinct from the
          two USDC/Morpho figures beside it: native coin is **not** an Invest
          instrument and cannot be allocated.
        */}
        <Stat
          label='Qualified position'
          testId='invest-stat-qualified'
          value={
            qualifiedPosition.status === 'known'
              ? usd2(qualifiedPosition.usd)
              : '—'
          }
          mutedValue={qualifiedPosition.status === 'unknown'}
          note={
            qualifiedPosition.status === 'known'
              ? 'Native, USDC and allocations · the same total as Holdings'
              : qualifiedPosition.reason
          }
        />
        <Stat
          label='Vault USDC available'
          testId='invest-stat-vault-usdc'
          value={
            position.freeUsdc.status === 'known'
              ? usd(position.freeUsdc.usd)
              : '—'
          }
          mutedValue={position.freeUsdc.status === 'unknown'}
          note={
            position.freeUsdc.status === 'known'
              ? 'Free USDC only · not the qualified total.'
              : position.freeUsdc.reason
          }
        />
        {/*
          The figure is the Safe's **current** on-chain position, not a
          per-session count (nothing persists a session figure), so the label
          says what the number actually is rather than "this session".
        */}
        <Stat
          label='Currently allocated'
          testId='invest-stat-allocated'
          value={
            position.allocated.status === 'known'
              ? usd(position.allocated.usd)
              : '—'
          }
          mutedValue={position.allocated.status === 'unknown'}
          note={
            position.allocated.status === 'known'
              ? `${position.heldCount} instrument${
                  position.heldCount === 1 ? '' : 's'
                } · shown in Holdings`
              : position.allocated.reason
          }
        />
      </div>

      <Modal
        open={selected !== null}
        onClose={closeModal}
        title={
          selected
            ? selected.wired
              ? // The reference's eyebrow is the dialog's top line, with the
                // instrument named just below it in the body.
                direction === 'unallocate'
                ? 'UN-ALLOCATE'
                : 'NEW ALLOCATION'
              : selected.name
            : 'Allocate'
        }
        // The reference's allocate panel is `max-width: 440px`
        // (kade-mvp.dc.html, the "New allocation" dialog); the modal default is
        // the same, so this keeps the panel at the owner's requested width
        // rather than the 460px the screen previously passed.
        maxWidth={440}
      >
        {selected ? (
          <div
            style={{
              fontSize: '13px',
              color: tokens.chipFg,
              // The reference's dialog body padding (kade-mvp.dc.html, the "New
              // allocation" panel) is `22px` on every side; the header above is
              // the Modal's, so the top padding here is the reference's 22px
              // less the header's own bottom spacing.
              padding: '22px',
            }}
          >
            {/*
              For a wired instrument the dialog's top line is the reference's
              eyebrow (`NEW ALLOCATION` / `UN-ALLOCATE`), so the instrument is
              named here. An unwired instrument has no eyebrow and keeps its
              name as the title, so it is not repeated.
            */}
            {selected.wired ? (
              <div
                style={{
                  // The reference's instrument name: 15px, weight 700.
                  fontSize: '15px',
                  fontWeight: 700,
                  color: tokens.ink,
                  lineHeight: 1.25,
                }}
              >
                {selected.name}
              </div>
            ) : null}
            {/*
              The reference's header line: the instrument's venue, then its
              terms (12px, muted, a 4px gap under the name). The `type` is
              carried by the table row, so it is not repeated here.
            */}
            <div
              style={{ fontSize: '12px', color: tokens.muted, marginTop: '4px' }}
            >
              {selected.venue} · {selected.terms}
            </div>

            {selected.wired ? (
              <>
                {/*
                  The reference's "Settles on <chain>" chip. The chain is the
                  row's own chain — never a selector — so it cannot disagree
                  with the deposit the server builds.
                */}
                <div
                  style={{
                    marginTop: '6px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: tokens.surface,
                    border: `1px solid ${tokens.border}`,
                    borderRadius: '999px',
                    // The reference's "Settles on" chip: 11.5px, `3px 9px`,
                    // radius 999px, a 6px gap under the venue line.
                    padding: '3px 9px',
                    fontSize: '11.5px',
                    color: tokens.chipFg,
                  }}
                >
                  <span>Settles on</span>
                  <ChainChip
                    name={selected.chain}
                    color={selected.chainColor}
                  />
                </div>

                <label
                  htmlFor='invest-amount'
                  style={{
                    display: 'block',
                    marginTop: '16px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: tokens.muted,
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

                {/*
                  The reference's allocate summary box. Every figure is derived
                  from real data or is explicitly unknown — never invented:
                  Minimum is the instrument's own minimum, from the one `$1`
                  source of truth; Estimated income is the typed amount times
                  the vault's yield read from Morpho (or `Not quoted` with the
                  specific reason when that read failed); Vault USDC after is the
                  row chain's free USDC less the amount (or an explained
                  unknown); Qualifying balance is unchanged by design, because
                  allocations stay locked and keep counting.
                */}
                {direction === 'allocate' ? (
                  <div
                    data-testid='invest-allocate-summary'
                    style={{
                      marginTop: '16px',
                      background: tokens.surface,
                      border: `1px solid ${tokens.border}`,
                      borderRadius: '12px',
                      padding: '14px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      fontSize: '13px',
                    }}
                  >
                    <Row
                      label='Minimum'
                      value={selected.minimum}
                      testId='invest-summary-minimum'
                    />
                    <Row
                      label='Estimated income'
                      value={estimatedIncome.value}
                      title={estimatedIncome.title}
                      valueColor={
                        estimatedIncome.muted ? tokens.muted : undefined
                      }
                      testId='invest-summary-income'
                    />
                    <Row
                      label='Vault USDC after'
                      value={vaultAfter.value}
                      title={vaultAfter.title}
                      valueColor={vaultAfter.muted ? tokens.muted : undefined}
                    />
                    <Row
                      label='Qualifying balance'
                      value='unchanged'
                      title='Allocations stay locked and keep counting toward your permit, so this figure does not change.'
                      valueColor={tokens.success}
                    />
                  </div>
                ) : null}

                {/* The reference's closing copy for the allocate direction. */}
                {direction === 'allocate' ? (
                  <div
                    style={{
                      marginTop: '14px',
                      fontSize: '12px',
                      color: tokens.muted,
                      lineHeight: 1.6,
                    }}
                  >
                    Settles from vault USDC in one Safe transaction and appears
                    in Holdings. Stays locked for the permit term.
                  </div>
                ) : null}

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

                {/*
                  The owner asked for the contract information to sit behind a
                  "ver más"-style disclosure rather than dominate the panel. It
                  is collapsed by default and revealed on demand. The control is
                  a real <button> carrying `aria-expanded` (keyboard-reachable),
                  and every address inside reuses `CopyableValue`: shown
                  truncated, with a copy button holding the full value and an
                  explorer link pointing at that value's own chain.
                */}
                <div
                  style={{
                    marginTop: '16px',
                    borderTop: `1px solid ${tokens.border}`,
                    paddingTop: '12px',
                  }}
                >
                  <button
                    type='button'
                    aria-expanded={contractsOpen}
                    aria-controls={contractDetailsId}
                    onClick={() => setContractsOpen((open) => !open)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      border: 0,
                      background: 'transparent',
                      padding: 0,
                      fontFamily: 'inherit',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: tokens.brandPrimary,
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      aria-hidden='true'
                      style={{
                        display: 'inline-block',
                        transition: 'transform .15s ease',
                        transform: contractsOpen ? 'rotate(90deg)' : 'none',
                      }}
                    >
                      ›
                    </span>
                    Show contract details
                  </button>
                  <div
                    hidden={!contractsOpen}
                    id={contractDetailsId}
                    data-testid='invest-contract-details'
                    style={{ marginTop: '8px' }}
                  >
                    <dl style={{ margin: 0, fontSize: '12.5px' }}>
                      <Detail label='Vault chain' first>
                        <span style={{ color: tokens.chipFg }}>
                          {selectedRail
                            ? `${selectedRail.chainName} · ${selectedRail.chainId}`
                            : 'Not configured'}
                        </span>
                      </Detail>
                      <Detail label='MetaMorpho vault'>
                        {selectedRail?.vault != null ? (
                          <CopyableValue
                            value={selectedRail.vault}
                            label='MetaMorpho vault address'
                            explorerUrl={addressExplorerUrl(
                              selectedRail.chainId,
                              selectedRail.vault,
                            )}
                          />
                        ) : (
                          <span style={{ color: tokens.muted }}>
                            Not configured
                          </span>
                        )}
                      </Detail>
                      <Detail label='Underlying USDC'>
                        {selectedRail?.usdc != null ? (
                          <CopyableValue
                            value={selectedRail.usdc}
                            label='USDC address'
                            explorerUrl={addressExplorerUrl(
                              selectedRail.chainId,
                              selectedRail.usdc,
                            )}
                          />
                        ) : (
                          <span style={{ color: tokens.muted }}>
                            Not configured
                          </span>
                        )}
                      </Detail>
                    </dl>
                  </div>
                </div>

                {/* The reference's button row: the action and a Cancel. */}
                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    marginTop: '18px',
                    marginBottom: '16px',
                  }}
                >
                  <Button
                    style={{ flex: '1 1 auto' }}
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
                  <Button
                    variant='secondary'
                    onClick={closeModal}
                    ariaLabel='Cancel'
                  >
                    Cancel
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
                {/*
                  The owner asked for the confirmed transaction's identifiers
                  to fold away the same way the contract details already do, so
                  the success notice leads rather than four rows of hex. This is
                  the same disclosure idiom as the contract block: a real
                  <button> carrying `aria-expanded`/`aria-controls`, collapsed
                  by default. Nothing inside is changed — each value stays
                  truncated with a copy control holding the full value and an
                  explorer link on its own chain, and a missing transaction hash
                  still renders "Not reported" with no link.
                */}
                <div
                  style={{
                    marginTop: '12px',
                    borderTop: `1px solid ${tokens.border}`,
                    paddingTop: '12px',
                  }}
                >
                  <button
                    type='button'
                    aria-expanded={detailsOpen}
                    aria-controls={detailsId}
                    onClick={() => setDetailsOpen((open) => !open)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      border: 0,
                      background: 'transparent',
                      padding: 0,
                      fontFamily: 'inherit',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: tokens.brandPrimary,
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      aria-hidden='true'
                      style={{
                        display: 'inline-block',
                        transition: 'transform .15s ease',
                        transform: detailsOpen ? 'rotate(90deg)' : 'none',
                      }}
                    >
                      ›
                    </span>
                    {direction === 'unallocate'
                      ? 'Show un-allocate details'
                      : 'Show deposit details'}
                  </button>
                  <div
                    hidden={!detailsOpen}
                    id={detailsId}
                    data-testid={
                      direction === 'unallocate'
                        ? 'invest-unallocate-details'
                        : 'invest-deposit-details'
                    }
                    style={{ marginTop: '8px' }}
                  >
                    <dl style={{ margin: 0, fontSize: '13px' }}>
                      <Detail label='Transaction' first>
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
                          <span style={{ color: tokens.muted }}>
                            Not reported
                          </span>
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
                </div>
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
  testId,
  mutedValue,
}: {
  label: string;
  value: string;
  note: string;
  /** Identifies the figure in tests; the label stays presentational. */
  testId?: string;
  /** True when the figure is `—` because the read failed, not a real number. */
  mutedValue?: boolean;
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
        data-testid={testId}
        style={{
          fontSize: '26px',
          fontWeight: 700,
          marginTop: '8px',
          fontVariantNumeric: 'tabular-nums',
          color: mutedValue ? tokens.muted : undefined,
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

/**
 * A label/value line inside the allocate summary box. The box spaces its rows
 * itself (the reference uses a flex column with a gap), so a row carries no
 * divider of its own.
 */
function Row({
  label,
  value,
  title,
  valueColor,
  testId,
}: {
  label: string;
  value: string;
  /** The specific reason a figure is unknown, shown on hover. */
  title?: string;
  /** Colours the value, e.g. to mark it unknown or to accent it. */
  valueColor?: string;
  /** Identifies the row's value in tests; the label stays presentational. */
  testId?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
      }}
    >
      <span style={{ color: tokens.muted, flex: '0 0 auto' }}>{label}</span>
      <span
        data-testid={testId}
        title={title}
        style={{
          fontWeight: 600,
          minWidth: 0,
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
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
  first,
}: {
  label: string;
  children: React.ReactNode;
  /** Omits the top divider, for the first row in a bordered block. */
  first?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: '12px',
        padding: '7px 0',
        borderTop: first ? undefined : `1px solid ${tokens.border}`,
      }}
    >
      <span style={{ color: tokens.muted, flex: '0 0 auto' }}>{label}</span>
      <span style={{ minWidth: 0, textAlign: 'right' }}>{children}</span>
    </div>
  );
}
