'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { LockedAction } from '@/components/ui/LockedAction';
import { tokens } from '@/components/ui/tokens';
import { tierMinimumUsdc } from '@/lib/residency/checks';
import { chainColor } from '@/lib/wealth/chain-colors';
import {
  EVM_READ_CHAINS,
  USDC_DECIMALS,
  usdcAddressForChain,
} from '@/lib/wealth/evm';
import { shortAddress, usd } from '@/lib/wealth/format';
import type {
  HoldingWallet,
  HoldingsAggregate,
  UnverifiedHoldingWallet,
} from '@/lib/wealth/holdings';
import type { EvmChainBalance } from '@/lib/wealth/types';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';
import {
  summarizeQualifiedPosition,
  type QualifiedPosition,
} from '@/lib/wealth/qualified-position';
import { provenanceLabel } from './provenance';

/**
 * Holdings — the design reference's layout over **real data only**.
 *
 * The screen renders the aggregate `aggregateHoldings` produced: the four
 * summary cards, the per-chain totals over the signature-verified wallets, the
 * qualified-vault section, the reference's "In linked wallets" table, the
 * Reflect/USDT+ card and the reference's closing card.
 *
 * "In linked wallets" adopts the reference's table grid (`1.5fr .9fr .9fr .9fr
 * 130px`): one row per **readable holding** — the native coin and, when the read
 * produced one, the USDC balance of a linked wallet — with the wallet's address
 * and provenance in the asset cell. A holding belonging to a signature-verified
 * wallet is counted in the total and carries the vault action; one belonging to
 * a `connected-wallet` / `pasted-address` row is marked unverified, carries its
 * provenance, is excluded from the total, and carries the sign action. A stored
 * chain whose balance could not be read is shown as its own `—` row rather than
 * hidden, a chain that read natively but whose USDC sub-read failed gets an
 * explicit `—` USDC row carrying the specific reason, and a wallet whose read
 * failed entirely still gets a row with the real error.
 *
 * Copy policy (owner override, this iteration): every visible string is taken
 * **verbatim from the reference**, even where it describes an intended state the
 * code cannot yet produce ("KadeLock", a lock date, a 2-of-2 threshold, a yield,
 * the multi-chain vault, the cure period). The **arithmetic is real**: the
 * `QUALIFIED` card reads the one on-chain qualified total the server computed
 * with `summarizeQualifiedPosition` (an unread read keeps its reason, never a
 * fabricated `$0`), `Not qualified` is the verified linked-wallet aggregate, and
 * `Total holdings` is their sum so the two partition the total. An unverified
 * wallet is still excluded from both, and a chain whose read failed still
 * shows `—`. The per-row "Move to vault" on a verified row is now a real
 * control for a **movable** holding: both a USDC token and the chain's native
 * coin open the injected dialog so the resident's own wallet can sign the move.
 * A row with nothing movable (an unread balance, a chain whose token is not
 * configured, an empty balance) or no known Safe address stays disabled with
 * its **true** reason. "Fund from bank" and "Convert to USDT+" stay disabled
 * with their real reason, and the unverified per-row state stays visible.
 *
 * The `QUALIFIED` card's tier sub-line is the owner's one unfrozen exception:
 * the reference hardcoded a tier and the full minimum, which contradicted the
 * card's own figure and the residency funds check. It is now derived from the
 * real total and the resident's recorded tier (see `qualifiedTierSub`), so the
 * two surfaces cannot state different tiers; with no tier recorded it claims
 * none rather than inventing one.
 *
 * "Balances by chain" renders the chains we actually read
 * (`EVM_READ_CHAINS` — Ethereum, Base and Arbitrum One) with their real
 * figures, plus only the reference's genuinely unread cards (Optimism, Celo)
 * as `—`; no chain is claimed unread when it is read, and no unread card is
 * invented with a figure. Reflect/
 * USDT+ does not exist, so its card is rendered with the reference's own figures
 * (the owner's declared exception) and a small demo chip; none of its figures
 * flow into the total, the qualified figure or any other real number.
 *
 * Presentational discipline: everything comes in as props. The wallet
 * machinery behind "Verify wallets" is injected as `renderVerifyWallets` and
 * the dialog behind the per-row "Move to vault" is opened through
 * `onMoveToVault`, so this component renders without a wallet and its tests
 * never need one.
 */
export interface HoldingsScreenProps {
  readonly aggregate: HoldingsAggregate;
  /** The resident's Safe address from `safe_deployments`, or null/absent. */
  readonly safeAddress?: string | null;
  /**
   * Renders the "Verify wallets" control that opens the verification modal. The
   * modal owns the per-wallet connect → persist → sign flow, so this screen
   * stays free of the wallet machinery. When omitted, no control is rendered and
   * the unverified rows still show their chip, provenance and exclusion.
   */
  readonly renderVerifyWallets?: () => ReactNode;
  /**
   * Opens the "Move to vault" dialog for a verified ERC-20 row. The owner of
   * the dialog (and of the wallet machinery behind it) is the caller, so this
   * screen stays presentational and renders without a wallet. When omitted the
   * control is still shown, disabled with a true reason.
   */
  readonly onMoveToVault?: (target: MoveToVaultTarget) => void;
  /**
   * The resident Safe's on-chain holdings, read server-side and pointed at the
   * Safe address. Rendered under "Qualified vaults" with chain + instrument +
   * amount. Empty/absent keeps the truthful empty state.
   */
  readonly vaultHoldings?: readonly VaultHoldingRow[];
  /**
   * The Safe's qualified total, produced **once** by the server with
   * `summarizeQualifiedPosition` from the same rows. The `QUALIFIED` card reads
   * this value, so the card and the residency tier check share one computation
   * rather than diverging. When omitted the screen reduces `vaultHoldings` with
   * the same function, so a bare render stays consistent.
   */
  readonly qualified?: QualifiedPosition;
  /**
   * The resident's recorded qualifying tier (`applications.tier`), or
   * null/absent when none is recorded. The `QUALIFIED` card's sub-line is
   * derived from this and the real qualified total through
   * {@link qualifiedTierSub}, using the same `tierMinimumUsdc` the residency
   * funds check uses, so the two surfaces cannot state different tiers. When
   * absent the card claims no tier rather than inventing one.
   */
  readonly tier?: string | null;
}

/**
 * What a row's "Move to vault" action hands to the dialog.
 *
 * The asset is the row's own: `kind` distinguishes the chain's native coin
 * (`tokenAddress` null) from an ERC-20 token (`tokenAddress`, the row's own
 * contract). It is never chosen in the dialog. An unread row is never movable
 * and never reaches the dialog.
 */
export interface MoveToVaultTarget {
  /** The row's stable key, so the dialog can be tied back to it in tests. */
  readonly key: string;
  /** Whether the row is an ERC-20 token or the chain's native coin. */
  readonly kind: 'erc20' | 'native';
  /** The token symbol shown on the row (e.g. `USDC`). */
  readonly symbol: string;
  /** The token's display name (e.g. `USDC`). */
  readonly name: string;
  /** The wallet the row belongs to: only this wallet may sign. */
  readonly address: string;
  /** The chain the token sits on. */
  readonly chainId: number;
  readonly chainName: string;
  /** The ERC-20 contract to move, or null for the chain's native coin. */
  readonly tokenAddress: string | null;
  /** The token's decimals, so the amount is validated and parsed correctly. */
  readonly decimals: number;
  /** The row's read amount, as the dialog's starting value. */
  readonly amount: string;
}

/**
 * The chains this app actually reads for EVM balances.
 *
 * This is deliberately the **same single source of truth** the balance read
 * uses (`EVM_READ_CHAINS`), not a hardcoded copy: a chain added to or removed
 * from the read set must change the per-chain card, the label and the total
 * together, or the parts stop adding up to the whole they are shown as. The
 * reference lists five chains; this section renders the ones the app reads plus
 * the genuinely unread cards below.
 */
const READ_CHAINS = EVM_READ_CHAINS;

/** Chain id → display name for the chains we read, for a stored-but-unread row. */
const CHAIN_NAMES = new Map<number, string>(
  READ_CHAINS.map((chain) => [chain.chainId, chain.name]),
);

/** True for a chain id this app actually reads balances on. */
const READ_CHAIN_IDS = new Set<number>(
  READ_CHAINS.map((chain) => chain.chainId),
);

/**
 * The honest reasons the vault action is unavailable on a given row. Each is
 * true of the state that produces it; a verified ERC-20 or native row with a
 * known Safe is never disabled, so it never carries one of these.
 */
/** The Safe address has not been recorded, so there is nowhere to send. */
const NO_SAFE_REASON =
  'Your vault address is not ready yet, so there is nowhere to send this holding.';
/**
 * The balance could not be read, so there is no asset to move. The row is not a
 * token and nothing is "locked": there is simply no known amount.
 */
const UNREAD_REASON =
  'This balance could not be read, so there is no known amount to move.';
/** The read produced no balance at all. */
const EMPTY_REASON = 'This holding is empty, so there is nothing to move.';
/** USDC exists on the chain but this build has no contract address for it. */
const UNSUPPORTED_TOKEN_REASON =
  'Moving USDC on this chain is not supported yet. It stays in your wallet.';
/** No wallet machinery was injected: the screen is rendering without a wallet. */
const NO_WALLET_REASON =
  'Wallet connection is not available here, so this holding cannot be moved.';

/**
 * The Reflect card uses the reference's own figures (the owner's declared
 * exception): the integration does not exist, so these are illustrative and
 * demo-marked. They are used **only** here and never feed the total, the
 * qualified figure or any tier arithmetic.
 */
const REFLECT_DEMO = {
  apy: '4.15%',
  available: '$150,000',
  yearly: '$6,225',
} as const;
const REFLECT_REASON =
  'Reflect/USDT+ conversion is not available: the Reflect integration does not exist in Week 2 (week-2 contract §9).';
/** The reference's note under the Reflect CTA (verbatim). */
const REFLECT_NOTE = 'One Safe transaction · stays inside your qualified vault';

/** The reference's "Balances by chain" section note (verbatim). */
const CHAIN_NOTE = 'Read from Ethereum, Base, Arbitrum, Optimism and Celo';

/** The reference's per-chain helper lines, and their colours. */
const CHAIN_AVAILABLE = 'Vault available';
const CHAIN_READONLY = 'Read-only';

/**
 * The chain cards the reference shows, paired with the helper line each uses.
 *
 * This is the reference's full five-chain row. The extra cards below are
 * **derived** from it by removing every chain id the app reads
 * (`READ_CHAIN_IDS`), so a chain that becomes read — as Arbitrum One did — drops
 * its "unread" card automatically instead of leaving one that claims a chain is
 * unread when it is read. The genuinely unread cards keep the reference's
 * presentation, but the value is an explicit `—`: this app has no balance for a
 * chain it does not read, so no figure is shown. Nothing here feeds the
 * aggregate or any real total.
 */
const REFERENCE_CHAINS = [
  { chainId: 1, name: 'Ethereum', sub: CHAIN_AVAILABLE },
  { chainId: 8453, name: 'Base', sub: CHAIN_AVAILABLE },
  // The frozen registry names chain 42161 "Arbitrum One"; it is now read, so the
  // filter below removes this card.
  { chainId: 42161, name: 'Arbitrum One', sub: CHAIN_AVAILABLE },
  { chainId: 10, name: 'Optimism', sub: CHAIN_READONLY },
  { chainId: 42220, name: 'Celo', sub: CHAIN_READONLY },
] as const;

/**
 * The reference's chain cards this app does **not** read, re-derived from the
 * read set rather than hardcoded: reference chains minus `READ_CHAIN_IDS`. The
 * value is always `null` — an unread chain has no balance to show, so its card
 * renders `—` and never a fabricated figure.
 */
const REFERENCE_EXTRA_CHAINS = REFERENCE_CHAINS.filter(
  (chain) => !READ_CHAIN_IDS.has(chain.chainId),
).map((chain) => ({ ...chain, usd: null as number | null }));

/** The reference's qualified-vaults section note (verbatim). */
const QUALIFIED_NOTE = 'Ethereum · Base · Arbitrum · KadeLock · locked to Nov 2031';

/**
 * The sub-line under the `QUALIFIED` card, derived from the **real** position
 * and the resident's recorded tier.
 *
 * The reference's tier line is not kept verbatim: it hardcoded a single tier
 * and the full minimum, which contradicted both the card above it and the
 * residency funds check reading the same total. The line here is computed from
 * the one qualified total the card already shows and the one tier threshold the
 * residency surface uses (`tierMinimumUsdc`, backed by `@kade/shared` `TIERS`),
 * so the two surfaces cannot disagree:
 *
 *   - an unreadable position keeps its specific reason (never a tier claim, and
 *     never a fabricated figure);
 *   - at or above the resident's tier it says so, naming that tier;
 *   - below it shows the real shortfall, not the full minimum;
 *   - with no tier recorded there is nothing to compare against, so it names no
 *     tier and claims no threshold.
 */

/** Nothing recorded to compare the total to, so no tier is claimed. */
const NO_TIER_SUB = 'No qualifying tier is recorded.';
/** A tier is recorded but not one this build can read a minimum for. */
const UNKNOWN_TIER_SUB = 'The recorded tier is not one we can check.';

function qualifiedTierSub(
  tier: string | null | undefined,
  position: QualifiedPosition,
): string {
  // Fail closed: an unknown read keeps its real reason. Handled first so a
  // failed read can never turn into a "meets the tier" claim.
  if (position.status === 'unknown') return position.reason;

  const recorded = typeof tier === 'string' ? tier.trim() : '';
  if (recorded === '') return NO_TIER_SUB;
  const minimum = tierMinimumUsdc(recorded);
  if (minimum === null) return UNKNOWN_TIER_SUB;

  const balance = position.usd;
  if (balance >= minimum) return `Meets the ${recorded} tier.`;

  const shortfall = minimum - balance;
  return `Below ${recorded} tier — ${usd(shortfall)} to go`;
}

/** The reference's "In linked wallets" section note (verbatim). */
const LINKED_NOTE = 'Proof of wealth · not counted until moved';

/** The reference's closing paragraph (verbatim), inside its own card. */
const CLOSING_PARAGRAPH =
  'Qualified vaults run on Ethereum, Base and Arbitrum at the same address, and your tier is the total across all three — deposits and yield positions can sit on whichever chain suits the instrument. Fiat on and off ramps settle on Ethereum and are bridged for you. KadeLock blocks outbound transfers until the unlock date, except to programme fee addresses and approved instruments. Immigration can verify and attest, never move funds. If the qualified total drops below tier, a 90-day cure period starts automatically.';

/** Circle colours for the table's asset glyphs. Presentation only. */
const USDC_COLOR = '#2775CA';
/** Morpho's brand blue for the MetaMorpho vault glyph. Presentation only. */
const MORPHO_COLOR = '#2470FF';

/** The reference's native asset is named "Ethereum"; ours are symbol-first. */
const NATIVE_ASSET_NAMES: Record<string, string> = { ETH: 'Ether' };

interface ChainTotal {
  readonly chainId: number;
  readonly name: string;
  /** Sum of the readable USD values on this chain, or null when none read. */
  readonly usd: number | null;
  /** Verified wallets with a **stored row** on this chain (from `chainIds`). */
  readonly wallets: number;
  /** Of those, how many produced a readable USD figure for this chain. */
  readonly valued: number;
}

/**
 * Aggregate the signature-verified wallets' per-chain reads.
 *
 * Only chains we actually read are produced. Presence is counted from the
 * wallets' **stored rows** (`chainIds`), not from their read results, so a
 * wallet whose read failed is still known to be linked on that chain; the value,
 * though, is the sum of the **readable** per-chain figures, so it can never
 * fabricate a zero and reconstructs the same total. When nothing readable
 * exists, `usd` is null and the card renders `—` with the correct reason.
 */
function chainTotals(wallets: readonly HoldingWallet[]): ChainTotal[] {
  return READ_CHAINS.map(({ chainId, name }) => {
    let sum = 0;
    let stored = 0;
    let valued = 0;
    for (const wallet of wallets) {
      if (wallet.chainIds.includes(chainId)) stored += 1;
      for (const chain of wallet.chains) {
        if (chain.chainId !== chainId) continue;
        if (chain.usd !== null) {
          sum += chain.usd;
          valued += 1;
        }
      }
    }
    return {
      chainId,
      name,
      usd: valued === 0 ? null : sum,
      wallets: stored,
      valued,
    };
  });
}

/**
 * What kind of holding a row is, from the read that produced it.
 *
 * `erc20` and `native` are the two kinds the EOA → Safe path can move; `unread`
 * (a chain whose balance could not be read) and `none` (a wallet with nothing
 * readable at all) have no asset to move and stay without an action.
 */
type HoldingKind = 'erc20' | 'native' | 'unread' | 'none';

/** One row of the "In linked wallets" table: a real, readable holding. */
interface WalletAssetRow {
  readonly key: string;
  /** Glyph inside the 24px circle, e.g. `ETH`, `USDC`, `—`, `EVM`. */
  readonly symbol: string;
  readonly circleColor: string;
  readonly name: string;
  /** The provenance line: address + verification state, never a value. */
  readonly provenance: string;
  readonly chain: string;
  readonly chainColor: string;
  readonly amount: string;
  readonly value: string;
  /** The chain the holding sits on, or null when there is no chain. */
  readonly chainId: number | null;
  readonly kind: HoldingKind;
  /** The ERC-20 contract to move, or null for a native/unread holding. */
  readonly tokenAddress: string | null;
  /** The token's decimals (USDC's 6 for an ERC-20, native's 18 otherwise). */
  readonly decimals: number;
  /** The read amount without the symbol, for the dialog's starting value. */
  readonly tokenAmount: string | null;
}

/** A row plus the wallet state its action needs. */
interface LinkedRow extends WalletAssetRow {
  readonly address: string;
  readonly verified: boolean;
  readonly unverifiedWallet: UnverifiedHoldingWallet | null;
  /** Only set on the first row of a wallet, so the error is shown once. */
  readonly readError: string | null;
}

/** The provenance line for a signature-verified wallet. */
function verifiedProvenance(wallet: HoldingWallet): string {
  return `${shortAddress(wallet.address)}`;
}

/**
 * Turn one wallet's real reads into the table's per-holding rows.
 *
 * Every row's amount and value come straight from the read: a native coin row
 * per readable chain, a USDC row when the read produced one, an explicit `—`
 * USDC row with the specific reason when the chain read natively but its token
 * sub-read failed, and an explicit `—` row for a stored chain whose balance
 * could not be read. Nothing is fabricated and no zero is invented; a wallet
 * with nothing readable at all still gets one honest `—` row rather than
 * disappearing.
 */
function assetRows(
  wallet: HoldingWallet | UnverifiedHoldingWallet,
  provenance: string,
): WalletAssetRow[] {
  const rows: WalletAssetRow[] = [];

  for (const chain of wallet.chains) {
    rows.push({
      key: `${wallet.address}:${chain.chainId}:native`,
      symbol: chain.nativeSymbol,
      circleColor: chainColor(chain.name),
      name: NATIVE_ASSET_NAMES[chain.nativeSymbol] ?? chain.nativeSymbol,
      provenance,
      chain: chain.name,
      chainColor: chainColor(chain.name),
      amount: `${chain.nativeAmount} ${chain.nativeSymbol}`,
      value: chain.nativeUsd === null ? '—' : usd(chain.nativeUsd),
      chainId: chain.chainId,
      // The native coin has no ERC-20 contract: it moves as `{ to, value }`,
      // so `tokenAddress` stays null and the dialog sends it natively.
      kind: 'native',
      tokenAddress: null,
      decimals: 18,
      tokenAmount: chain.nativeAmount,
    });

    if (chain.usdc) {
      rows.push({
        key: `${wallet.address}:${chain.chainId}:usdc`,
        symbol: chain.usdc.symbol,
        circleColor: USDC_COLOR,
        name: chain.usdc.symbol,
        provenance,
        chain: chain.name,
        chainColor: chainColor(chain.name),
        amount: `${chain.usdc.amount} ${chain.usdc.symbol}`,
        value: chain.usdc.usd === null ? '—' : usd(chain.usdc.usd),
        chainId: chain.chainId,
        kind: 'erc20',
        // The same table the balance read used, so the token moved is the token
        // that was read. Null when this build has no contract for the chain.
        tokenAddress: usdcAddressForChain(chain.chainId),
        decimals: USDC_DECIMALS,
        tokenAmount: chain.usdc.amount,
      });
    } else if (chain.tokenFailure) {
      // The native read succeeded but the USDC sub-read failed: show the token
      // as an explicit `—` row carrying the specific reason, rather than
      // omitting it. A missing token is never fabricated as a zero, and the
      // row is never movable because there is no known amount.
      rows.push({
        key: `${wallet.address}:${chain.chainId}:usdc-unread`,
        symbol: '—',
        circleColor: tokens.locked,
        name: 'USDC',
        provenance: `${provenance} · ${chain.tokenFailure.message}`,
        chain: chain.name,
        chainColor: chainColor(chain.name),
        amount: '—',
        value: '—',
        chainId: chain.chainId,
        kind: 'unread',
        tokenAddress: null,
        decimals: 18,
        tokenAmount: null,
      });
    }
  }

  // A stored chain with no readable balance is shown as an explicit `—` row,
  // never hidden and never turned into a zero. The provenance line carries the
  // specific reason when the read reported one, so the resident sees *why* the
  // chain is unread rather than a generic dead end.
  const readable = new Set(wallet.chains.map((chain) => chain.chainId));
  const failureByChain = new Map(
    (wallet.failures ?? []).map((failure) => [failure.chainId, failure]),
  );
  for (const chainId of wallet.chainIds) {
    if (readable.has(chainId)) continue;
    const name = CHAIN_NAMES.get(chainId) ?? `Chain ${chainId}`;
    const failure = failureByChain.get(chainId);
    rows.push({
      key: `${wallet.address}:${chainId}:unread`,
      symbol: '—',
      circleColor: tokens.locked,
      name,
      provenance: failure
        ? `${provenance} · ${failure.message}`
        : `${provenance} · balance could not be read`,
      chain: name,
      chainColor: chainColor(name),
      amount: '—',
      value: '—',
      chainId,
      kind: 'unread',
      tokenAddress: null,
      decimals: 18,
      tokenAmount: null,
    });
  }

  if (rows.length === 0) {
    rows.push({
      key: `${wallet.address}:none`,
      symbol: 'EVM',
      circleColor: tokens.locked,
      name: 'EVM wallet',
      provenance,
      chain: '—',
      chainColor: tokens.border,
      amount: '—',
      value: '—',
      chainId: null,
      kind: 'none',
      tokenAddress: null,
      decimals: 18,
      tokenAmount: null,
    });
  }

  return rows;
}

/**
 * Every verified wallet's holdings, flattened into table rows.
 *
 * Unverified wallets are deliberately NOT rows here: the table shows the
 * wallets that count, and verification is the modal's job (opened from the
 * table footer). A pending wallet is listed in the modal, not rendered in the
 * table.
 */
function linkedRows(aggregate: HoldingsAggregate): LinkedRow[] {
  const rows: LinkedRow[] = [];

  const push = (
    wallet: HoldingWallet,
    verified: boolean,
    provenance: string,
  ) => {
    const holdings = assetRows(wallet, provenance);
    holdings.forEach((holding, index) => {
      rows.push({
        ...holding,
        address: wallet.address,
        verified,
        unverifiedWallet: null,
        readError: index === 0 ? wallet.readError : null,
      });
    });
  };

  for (const wallet of aggregate.wallets) {
    push(wallet, true, verifiedProvenance(wallet));
  }

  return rows;
}

/**
 * The true reason a verified row cannot move to the vault, or null when it can.
 *
 * Exactly one reason applies to any locked row, and it names the actual state
 * that blocks the move rather than a generic "not available".
 */
function moveToVaultLockedReason(
  row: LinkedRow,
  safeAddress: string | null,
  onMoveToVault: ((target: MoveToVaultTarget) => void) | undefined,
): string {
  if (row.kind === 'unread') return UNREAD_REASON;
  if (row.kind === 'none') return EMPTY_REASON;
  // An ERC-20 row without a contract cannot be built into a transfer.
  if (row.kind === 'erc20' && row.tokenAddress === null) {
    return UNSUPPORTED_TOKEN_REASON;
  }
  if (row.kind !== 'erc20' && row.kind !== 'native') return EMPTY_REASON;
  if (row.chainId === null) return EMPTY_REASON;
  if (row.tokenAmount === null || !(Number(row.tokenAmount) > 0)) {
    return EMPTY_REASON;
  }
  if (safeAddress === null || safeAddress.trim() === '') return NO_SAFE_REASON;
  if (!onMoveToVault) return NO_WALLET_REASON;
  return EMPTY_REASON;
}

/**
 * The per-row vault control: a real button for a movable ERC-20 or native row,
 * and a disabled control carrying its true reason for every other state. It owns
 * no wallet machinery; the click is handed to the injected `onMoveToVault`.
 */
function MoveToVaultButton({
  row,
  safeAddress,
  onMoveToVault,
}: {
  readonly row: LinkedRow;
  readonly safeAddress: string | null;
  readonly onMoveToVault?: (target: MoveToVaultTarget) => void;
}) {
  const movable =
    (row.kind === 'erc20' || row.kind === 'native') &&
    !(row.kind === 'erc20' && row.tokenAddress === null) &&
    row.chainId !== null &&
    row.tokenAmount !== null &&
    Number(row.tokenAmount) > 0 &&
    safeAddress !== null &&
    safeAddress.trim() !== '' &&
    !!onMoveToVault;

  if (movable && onMoveToVault && row.chainId !== null && row.tokenAmount !== null) {
    const target: MoveToVaultTarget = {
      key: row.key,
      kind: row.kind === 'native' ? 'native' : 'erc20',
      symbol: row.symbol,
      name: row.name,
      address: row.address,
      chainId: row.chainId,
      chainName: row.chain,
      tokenAddress: row.tokenAddress,
      decimals: row.decimals,
      amount: row.tokenAmount,
    };
    return (
      <button
        type="button"
        onClick={() => onMoveToVault(target)}
        title={`Move ${row.symbol} from ${shortAddress(row.address)} to your vault`}
        style={{ ...rowActionButton, ...activeRowActionButton }}
      >
        Move to vault
      </button>
    );
  }

  return (
    <LockedAction
      height={32}
      reason={moveToVaultLockedReason(row, safeAddress, onMoveToVault)}
      style={rowActionButton}
    >
      Move to vault
    </LockedAction>
  );
}

/** The glyph colour for a vault row: real instrument colour, or unread grey. */
function vaultCircleColor(row: VaultHoldingRow): string {
  if (row.readError) return tokens.locked;
  if (row.kind === 'usdc') return USDC_COLOR;
  if (row.kind === 'morpho') return MORPHO_COLOR;
  return chainColor(row.chainName);
}

/** The reference's summary card: uppercase eyebrow, 26px value, muted sub. */
function SummaryCard({
  label,
  value,
  sub,
  valueColor,
}: {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  readonly valueColor?: string;
}) {
  return (
    <div style={summaryCard}>
      <div style={summaryLabel}>{label}</div>
      <div style={{ ...summaryValue, color: valueColor ?? tokens.ink }}>
        {value}
      </div>
      {sub ? <div style={summarySub}>{sub}</div> : null}
    </div>
  );
}

export function HoldingsScreen({
  aggregate,
  safeAddress,
  renderVerifyWallets,
  onMoveToVault,
  vaultHoldings = [],
  qualified,
  tier,
}: HoldingsScreenProps) {
  const { total, walletCount, valuedCount, wallets, unverifiedCount } = aggregate;

  // When every verified wallet's read failed, the linked total is unknown, not
  // zero: rendering `$0` would be a fabricated figure. `valuedCount` is exactly
  // how many verified wallets a readable value came from, so `walletCount > 0`
  // with no valued wallet is the honest "unread" state — the same `—` the
  // onboarding Step 3 total renders when its sources are unread. A resident
  // with no verified wallets still shows the real empty sum.
  const linkedIsUnknown = walletCount > 0 && valuedCount === 0;

  // The one qualified total: the server computes it from the same on-chain rows
  // with `summarizeQualifiedPosition` and passes it in, so the card reads that
  // single value rather than reducing the rows a second time. A bare render
  // (no prop) still uses the same function, so the two can never disagree.
  const qualifiedPosition =
    qualified ??
    summarizeQualifiedPosition({
      safeAddress: safeAddress ?? null,
      rows: vaultHoldings,
    });
  const qualifiedKnown = qualifiedPosition.status === 'known';

  // The summary cards partition the resident's truth: Qualified is what is in
  // the vault, Not qualified is what is still in the linked wallets, and Total
  // is their sum. The total is unknown when either part is unknown, so a read
  // that failed never turns into a fabricated figure.
  const totalIsUnknown = linkedIsUnknown || !qualifiedKnown;
  const totalUsd = qualifiedKnown ? qualifiedPosition.usd + total : total;

  const chains = chainTotals(wallets);
  const rows = linkedRows(aggregate);

  return (
    <div>
      <div style={headerRow}>
        <div>
          <h1 style={pageTitle}>Holdings</h1>
          <p style={pageSubtitle}>
            Everything you hold in one place. Only assets inside the qualified
            vault count toward your permit — move funds in to qualify them.
          </p>
        </div>
        <LockedAction
          height={40}
          reason="Bank transfers are deferred to the end of the programme (week-2 contract §2.1)"
          style={{ fontSize: '13px', padding: '0 18px' }}
        >
          Fund from bank
        </LockedAction>
      </div>

      <div className="kade-grid-4" style={{ gap: '14px', marginBottom: '16px' }}>
        <SummaryCard
          label="Total holdings"
          value={totalIsUnknown ? '—' : usd(totalUsd)}
          sub="vault + linked wallets"
        />
        <SummaryCard
          label="Qualified"
          value={qualifiedKnown ? usd(qualifiedPosition.usd) : '—'}
          sub={qualifiedTierSub(tier, qualifiedPosition)}
          valueColor={tokens.brandPrimary}
        />
        <SummaryCard
          label="Not qualified"
          value={linkedIsUnknown ? '—' : usd(total)}
          sub="proof of wealth · not counted"
        />
        <SummaryCard
          label="Vault lock"
          value="Nov 2031"
          sub="2-of-2 · 3.4% on USDY"
        />
      </div>

      <Card radius={14} style={{ marginBottom: '16px' }}>
        <div style={sectionHeader}>
          <h2 style={sectionHeading}>Balances by chain</h2>
          <span style={sectionNote}>{CHAIN_NOTE}</span>
        </div>
        <div style={chainGrid}>
          {chains.map((chain) => (
            <div key={chain.chainId} style={chainCard}>
              <div style={chainNameRow}>
                <span
                  aria-hidden
                  style={{ ...chainSwatch, background: chainColor(chain.name) }}
                />
                <span style={chainName}>{chain.name}</span>
              </div>
              <div style={chainValue}>
                {chain.usd === null ? '—' : usd(chain.usd)}
              </div>
              <div style={{ ...chainSubLine, color: tokens.success }}>
                {CHAIN_AVAILABLE}
              </div>
            </div>
          ))}
          {REFERENCE_EXTRA_CHAINS.map((chain) => (
            <div key={chain.chainId} style={chainCard}>
              <div style={chainNameRow}>
                <span
                  aria-hidden
                  style={{ ...chainSwatch, background: chainColor(chain.name) }}
                />
                <span style={chainName}>{chain.name}</span>
              </div>
              <div style={chainValue}>
                {chain.usd === null ? '—' : usd(chain.usd)}
              </div>
              <div
                style={{
                  ...chainSubLine,
                  color:
                    chain.sub === CHAIN_AVAILABLE
                      ? tokens.success
                      : tokens.muted,
                }}
              >
                {chain.sub}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card radius={14} style={{ marginBottom: '16px' }}>
        <div style={sectionHeader}>
          <h2 style={sectionHeading}>
            {safeAddress
              ? `Qualified vaults · Safe ${shortAddress(safeAddress)}`
              : 'Qualified vaults'}
          </h2>
          <span style={sectionNote}>{QUALIFIED_NOTE}</span>
        </div>
        {vaultHoldings.length === 0 ? (
          <div style={qualifiedEmpty}>
            Nothing qualified yet — move assets from your wallets below.
          </div>
        ) : (
          <>
            <div style={vaultHead}>
              <span>Instrument</span>
              <span>Chain</span>
              <span style={{ textAlign: 'right' }}>Amount</span>
            </div>
            {vaultHoldings.map((row) => (
              <div key={row.key} style={vaultRow}>
                <div style={assetCell}>
                  <span
                    aria-hidden
                    style={{ ...assetCircle, background: vaultCircleColor(row) }}
                  >
                    {row.symbol}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={assetName}>{row.name}</div>
                    {row.readError ? (
                      <div style={assetProvenance}>{row.readError}</div>
                    ) : null}
                  </div>
                </div>
                <span style={chainCell}>
                  <span
                    aria-hidden
                    style={{ ...tableSwatch, background: chainColor(row.chainName) }}
                  />
                  {row.chainName}
                </span>
                <span style={{ ...amountCell, textAlign: 'right' }}>
                  {row.amount}
                </span>
              </div>
            ))}
          </>
        )}
      </Card>

      <Card radius={14} style={{ marginBottom: '16px' }}>
        <div style={sectionHeader}>
          <h2 style={sectionHeading}>In linked wallets</h2>
          <span style={sectionNote}>{LINKED_NOTE}</span>
        </div>

        {rows.length === 0 && unverifiedCount > 0 ? (
          /*
           * The resident HAS linked wallets, they are just not verified: the
           * table has no rows, and the reference's "all in the vault" line would
           * be false (nothing is verified, and the vault does not exist). Say
           * what is actually true and point at the control that fixes it.
           */
          <p style={emptyNote}>
            Your linked wallets are not verified yet. Use{' '}
            <strong>Link &amp; verify wallets</strong> to prove you control them,
            so they count toward your holdings.
          </p>
        ) : rows.length === 0 ? (
          <p style={emptyNote}>
            All linked assets are in the qualified vault.
          </p>
        ) : (
          <>
            <div style={listHead}>
              <span>Asset</span>
              <span>Chain</span>
              <span>Amount</span>
              <span style={{ textAlign: 'right' }}>Value</span>
              <span />
            </div>
            {rows.map((row) => (
              <div key={row.key} style={listRow}>
                <div style={assetCell} title={row.address}>
                  <span
                    aria-hidden
                    style={{ ...assetCircle, background: row.circleColor }}
                  >
                    {row.symbol}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={assetName}>{row.name}</div>
                    <div style={assetProvenance}>{row.provenance}</div>
                  </div>
                </div>
                <span style={chainCell}>
                  <span
                    aria-hidden
                    style={{ ...tableSwatch, background: row.chainColor }}
                  />
                  {row.chain}
                </span>
                <span style={amountCell}>{row.amount}</span>
                <span style={valueCell}>{row.value}</span>
                <span style={actionCell}>
                  {row.verified ? (
                    <MoveToVaultButton
                      row={row}
                      safeAddress={safeAddress ?? null}
                      onMoveToVault={onMoveToVault}
                    />
                  ) : null}
                </span>
                {row.readError ? (
                  <div role="alert" style={rowError}>
                    {row.readError}
                  </div>
                ) : null}
              </div>
            ))}
          </>
        )}

        <div style={listFooter}>
          <span style={sectionNote}>
            {walletCount} wallets signed · balances read-only across 5 chains
          </span>
          {renderVerifyWallets ? renderVerifyWallets() : null}
        </div>
      </Card>

      {/*
        The Reflect card is the owner's declared exception: the integration does
        not exist, so the figures are mocked and demo-marked, and the CTA is
        disabled with the real reason. Nothing here feeds a real number.
      */}
      <Card
        radius={14}
        background="#fff"
        style={{ marginBottom: '16px', border: `1px solid ${tokens.action}` }}
      >
        <div style={reflectLayout}>
          <div>
            <div style={reflectHeaderRow}>
              <div style={reflectEyebrow}>Default USD vault · Reflect</div>
              <Chip tone="success" dot>
                Counts toward your permit
              </Chip>
              <Chip tone="warning" dot>
                Demo
              </Chip>
            </div>
            <h2 style={reflectTitle}>Hold dollars as USDT+</h2>
            <p style={reflectBody}>
              Idle USDC or USDT in your vault is converted to <strong>USDT+</strong>{' '}
              — Reflect&rsquo;s yield-bearing dollar. Yield accrues inside the
              token, so your balance grows without you doing anything, and it
              stays fully redeemable 1:1 back to USDC or USDT.
            </p>
            <div style={reflectStatGrid}>
              <div style={reflectStat}>
                <div style={reflectStatLabel}>Current APY</div>
                <div style={{ ...reflectStatValue, color: tokens.brandPrimary }}>
                  {REFLECT_DEMO.apy}
                </div>
              </div>
              <div style={reflectStat}>
                <div style={reflectStatLabel}>Backing</div>
                <div style={reflectStatValue}>T-bills</div>
              </div>
              <div style={reflectStat}>
                <div style={reflectStatLabel}>Redemption</div>
                <div style={reflectStatValue}>1:1 · daily</div>
              </div>
            </div>
            <div style={reflectChipRow}>
              <span style={convertChip}>USDC</span>
              <span>or</span>
              <span style={convertChip}>USDT</span>
              <span>→</span>
              <span style={convertChipAccent}>USDT+</span>
              <span>· in collaboration with Reflect</span>
            </div>
          </div>

          <div style={reflectPanel}>
            <div style={reflectStatLabel}>Available to convert</div>
            <div style={reflectPanelValue}>{REFLECT_DEMO.available}</div>
            <div style={reflectPanelSub}>
              vault USDC · earning nothing today
            </div>
            <div style={reflectDivider} />
            <div style={reflectRows}>
              <div style={reflectRow}>
                <span style={{ color: tokens.muted }}>Would earn</span>
                <span style={reflectRowValue}>
                  {REFLECT_DEMO.yearly} / yr
                </span>
              </div>
              <div style={reflectRow}>
                <span style={{ color: tokens.muted }}>Qualifying balance</span>
                <span style={{ color: tokens.success, fontWeight: 600 }}>
                  unchanged
                </span>
              </div>
              <div style={reflectRow}>
                <span style={{ color: tokens.muted }}>Lock</span>
                <span>none · redeem any day</span>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <LockedAction
              height={42}
              reason={REFLECT_REASON}
              style={reflectCta}
            >
              Convert to USDT+
            </LockedAction>
            <div style={reflectCtaNote}>{REFLECT_NOTE}</div>
          </div>
        </div>
      </Card>

      <Card radius={14} padding="20px 24px">
        <p style={closingParagraph}>{CLOSING_PARAGRAPH}</p>
      </Card>
    </div>
  );
}

const headerRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-end',
  gap: '24px',
  marginBottom: '24px',
  flexWrap: 'wrap',
};

const pageTitle: CSSProperties = {
  margin: 0,
  fontSize: '36px',
  lineHeight: 1.1,
  fontWeight: 700,
  letterSpacing: '-.02em',
};

const pageSubtitle: CSSProperties = {
  margin: '10px 0 0',
  color: tokens.muted,
  maxWidth: '64ch',
  textWrap: 'pretty',
};

const summaryCard: CSSProperties = {
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
  borderRadius: '14px',
  padding: '18px 20px',
};

const summaryLabel: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const summaryValue: CSSProperties = {
  fontSize: '26px',
  fontWeight: 700,
  marginTop: '8px',
  fontVariantNumeric: 'tabular-nums',
};

const summarySub: CSSProperties = {
  fontSize: '12.5px',
  color: tokens.muted,
  marginTop: '2px',
};

const sectionHeader: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '12px',
  flexWrap: 'wrap',
};

const sectionHeading: CSSProperties = {
  margin: 0,
  fontSize: '17px',
  fontWeight: 600,
};

const sectionNote: CSSProperties = {
  fontSize: '12.5px',
  color: tokens.muted,
};

const chainGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: '12px',
  marginTop: '16px',
};

const chainCard: CSSProperties = {
  background: '#fff',
  border: `1px solid ${tokens.border}`,
  borderRadius: '12px',
  padding: '13px 15px',
};

const chainNameRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '7px',
};

const chainSwatch: CSSProperties = {
  width: '9px',
  height: '9px',
  borderRadius: '2px',
  flex: '0 0 auto',
};

const chainName: CSSProperties = {
  fontSize: '12.5px',
  fontWeight: 600,
};

const chainValue: CSSProperties = {
  fontSize: '19px',
  fontWeight: 700,
  marginTop: '8px',
  fontVariantNumeric: 'tabular-nums',
};

const chainSubLine: CSSProperties = {
  fontSize: '11.5px',
  color: tokens.muted,
  marginTop: '2px',
};

const qualifiedEmpty: CSSProperties = {
  padding: '22px 0',
  textAlign: 'center',
  fontSize: '13px',
  color: tokens.muted,
};

/** The qualified-vaults table: instrument, chain, amount. */
const vaultHead: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.6fr .9fr 1fr',
  gap: '12px',
  padding: '12px 0 8px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: tokens.muted,
  borderBottom: `1px solid ${tokens.border}`,
  marginTop: '8px',
};

const vaultRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.6fr .9fr 1fr',
  gap: '12px',
  padding: '12px 0',
  fontSize: '13.5px',
  borderBottom: `1px solid ${tokens.border}`,
  alignItems: 'center',
};

const listHead: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.5fr .9fr .9fr .9fr 130px',
  gap: '12px',
  padding: '12px 0 8px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: tokens.muted,
  borderBottom: `1px solid ${tokens.border}`,
  marginTop: '8px',
};

const listRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.5fr .9fr .9fr .9fr 130px',
  gap: '12px',
  padding: '12px 0',
  fontSize: '13.5px',
  borderBottom: `1px solid ${tokens.border}`,
  alignItems: 'center',
};

const assetCell: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '9px',
  minWidth: 0,
};

const assetCircle: CSSProperties = {
  width: '24px',
  height: '24px',
  borderRadius: '50%',
  color: '#fff',
  fontSize: '9.5px',
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 auto',
};

const assetName: CSSProperties = {
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const assetProvenance: CSSProperties = {
  fontSize: '11.5px',
  color: tokens.muted,
};

const chainCell: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '7px',
  fontSize: '12.5px',
  color: tokens.chipFg,
  whiteSpace: 'nowrap',
};

const tableSwatch: CSSProperties = {
  width: '8px',
  height: '8px',
  borderRadius: '2px',
  flex: '0 0 auto',
};

const amountCell: CSSProperties = {
  color: tokens.muted,
  fontVariantNumeric: 'tabular-nums',
};

const valueCell: CSSProperties = {
  textAlign: 'right',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

const actionCell: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};

/** Sizing for the small per-row locked control, merged under `lockedStyle`. */
const rowActionButton: CSSProperties = {
  fontSize: '12px',
  padding: '0 14px',
};

/** The enabled per-row control's fill and pointer, over `rowActionButton`. */
const activeRowActionButton: CSSProperties = {
  height: '32px',
  border: 0,
  borderRadius: '999px',
  background: tokens.action,
  color: '#fff',
  fontFamily: 'inherit',
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const rowError: CSSProperties = {
  gridColumn: '1 / -1',
  marginTop: '4px',
  fontSize: '12.5px',
  color: tokens.danger,
};

const emptyNote: CSSProperties = {
  margin: '12px 0 0',
  fontSize: '13.5px',
  color: tokens.muted,
  maxWidth: '66ch',
};

const listFooter: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  marginTop: '16px',
  flexWrap: 'wrap',
};

const reflectLayout: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
  gap: '28px',
  alignItems: 'start',
};

const reflectHeaderRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  flexWrap: 'wrap',
};

const reflectEyebrow: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.action,
};

const reflectTitle: CSSProperties = {
  margin: '8px 0 6px',
  fontSize: '22px',
  fontWeight: 700,
  letterSpacing: '-.01em',
};

const reflectBody: CSSProperties = {
  margin: 0,
  fontSize: '13.5px',
  color: tokens.chipFg,
  textWrap: 'pretty',
};

const reflectStatGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: '10px',
  marginTop: '16px',
};

const reflectStat: CSSProperties = {
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
  borderRadius: '10px',
  padding: '11px 13px',
};

const reflectStatLabel: CSSProperties = {
  fontSize: '11px',
  color: tokens.muted,
};

const reflectStatValue: CSSProperties = {
  fontSize: '16px',
  fontWeight: 700,
  marginTop: '2px',
  fontVariantNumeric: 'tabular-nums',
};

const reflectChipRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginTop: '14px',
  flexWrap: 'wrap',
  fontSize: '12.5px',
  color: tokens.muted,
};

const convertChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  background: tokens.chipBg,
  borderRadius: '999px',
  padding: '5px 10px',
  fontWeight: 600,
  color: tokens.chipFg,
};

const convertChipAccent: CSSProperties = {
  ...convertChip,
  background: tokens.activeNavBg,
  fontWeight: 700,
  color: tokens.brandPrimary,
};

const reflectPanel: CSSProperties = {
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
  borderRadius: '12px',
  padding: '18px 20px',
  display: 'flex',
  flexDirection: 'column',
};

const reflectPanelValue: CSSProperties = {
  fontSize: '28px',
  fontWeight: 700,
  marginTop: '6px',
  fontVariantNumeric: 'tabular-nums',
};

const reflectPanelSub: CSSProperties = {
  fontSize: '12.5px',
  color: tokens.muted,
  marginTop: '2px',
};

const reflectDivider: CSSProperties = {
  height: '1px',
  background: tokens.border,
  margin: '14px 0',
};

const reflectRows: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '7px',
  fontSize: '12.5px',
};

const reflectRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
};

const reflectRowValue: CSSProperties = {
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

const reflectCta: CSSProperties = {
  marginTop: '16px',
  width: '100%',
  background: tokens.action,
  color: '#fff',
  border: '0',
  fontSize: '14px',
  padding: '0 22px',
};

const reflectCtaNote: CSSProperties = {
  marginTop: '10px',
  fontSize: '11.5px',
  color: tokens.muted,
  textAlign: 'center',
};

const closingParagraph: CSSProperties = {
  margin: 0,
  fontSize: '13px',
  color: tokens.chipFg,
  lineHeight: 1.7,
};
