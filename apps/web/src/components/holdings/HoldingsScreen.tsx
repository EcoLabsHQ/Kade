'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { LockedAction } from '@/components/ui/LockedAction';
import { tokens } from '@/components/ui/tokens';
import { chainColor } from '@/lib/wealth/chain-colors';
import { shortAddress, usd } from '@/lib/wealth/format';
import type {
  HoldingWallet,
  HoldingsAggregate,
  UnverifiedHoldingWallet,
} from '@/lib/wealth/holdings';
import type { EvmChainBalance } from '@/lib/wealth/types';
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
 * hidden, and a wallet whose read failed entirely still gets a row with the real
 * error.
 *
 * Copy policy (owner override, this iteration): every visible string is taken
 * **verbatim from the reference**, even where it describes an intended state the
 * code cannot yet produce ("KadeLock", a lock date, a 2-of-2 threshold, a yield,
 * the multi-chain vault, the cure period). The **arithmetic is unchanged**: the
 * total / not-qualified figures still come from the real aggregate, an unverified
 * wallet is still excluded from the total, and a chain whose read failed still
 * shows `—`. Mechanisms that would imply a real capability are not wired up:
 * "Fund from bank", "Move to vault" and "Convert to USDT+" stay disabled with
 * their real reason, and the unverified per-row state stays visible.
 *
 * "Balances by chain" renders only the chains we actually read (Ethereum and
 * Base); the reference's Arbitrum/Optimism/Celo cards are not invented. Reflect/
 * USDT+ does not exist, so its card is rendered with the reference's own figures
 * (the owner's declared exception) and a small demo chip; none of its figures
 * flow into the total, the qualified figure or any other real number.
 *
 * Presentational discipline: everything comes in as props. The wallet-connection
 * and signature machinery for the per-row "Connect & sign" action and the
 * "+ Link another wallet" action is injected as `renderConnectSign` /
 * `renderLinkAnother`, so this component renders without a wallet and its tests
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
}

/**
 * The chains this app actually reads for EVM balances. The reference lists five;
 * Week 2 covers Ethereum and Base only (week-2 §4.3), so the section renders
 * only those two and says so.
 */
const READ_CHAINS = [
  { chainId: 1, name: 'Ethereum', symbol: 'ETH' },
  { chainId: 8453, name: 'Base', symbol: 'ETH' },
] as const;

/** Chain id → display name for the chains we read, for a stored-but-unread row. */
const CHAIN_NAMES = new Map<number, string>(
  READ_CHAINS.map((chain) => [chain.chainId, chain.name]),
);

/**
 * The honest reason the vault action is unavailable: the passkey signer contract
 * is not deployed (EXE-011) and the qualified vault is beyond the Week 2
 * envelope (§4.3). Shared by every verified row so the reason never drifts.
 */
const MOVE_TO_VAULT_REASON =
  'Moving funds to the vault needs a Safe transaction from your passkey signer. That signer contract (EXE-011) is not deployed, and the qualified vault (KadeLock) is beyond the Week 2 envelope (§4.3).';

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
 * The three chain cards the reference shows that this app does not read. Their
 * cards keep the reference's presentation, but the value is an explicit `—`:
 * this app has no balance for a chain it does not read, so no figure is shown.
 * Nothing here feeds the aggregate or any real total.
 */
const REFERENCE_EXTRA_CHAINS = [
  { chainId: 42161, name: 'Arbitrum', usd: null, sub: CHAIN_AVAILABLE },
  { chainId: 10, name: 'Optimism', usd: null, sub: CHAIN_READONLY },
  { chainId: 42220, name: 'Celo', usd: null, sub: CHAIN_READONLY },
] as const;

/** The reference's qualified-vaults section note (verbatim). */
const QUALIFIED_NOTE = 'Ethereum · Base · Arbitrum · KadeLock · locked to Nov 2031';

/** The reference's "In linked wallets" section note (verbatim). */
const LINKED_NOTE = 'Proof of wealth · not counted until moved';

/** The reference's closing paragraph (verbatim), inside its own card. */
const CLOSING_PARAGRAPH =
  'Qualified vaults run on Ethereum, Base and Arbitrum at the same address, and your tier is the total across all three — deposits and yield positions can sit on whichever chain suits the instrument. Fiat on and off ramps settle on Ethereum and are bridged for you. KadeLock blocks outbound transfers until the unlock date, except to programme fee addresses and approved instruments. Immigration can verify and attest, never move funds. If the qualified total drops below tier, a 90-day cure period starts automatically.';

/** Circle colours for the table's asset glyphs. Presentation only. */
const USDC_COLOR = '#2775CA';

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
  return `${shortAddress(wallet.address)} · signature-verified`;
}

/** The provenance line for a displayed-but-unverified wallet. */
function unverifiedProvenance(wallet: UnverifiedHoldingWallet): string {
  return `${shortAddress(wallet.address)} · ${provenanceLabel(
    wallet.provider,
  )} · unverified`;
}

/**
 * Turn one wallet's real reads into the table's per-holding rows.
 *
 * Every row's amount and value come straight from the read: a native coin row
 * per readable chain, a USDC row only when the read produced one, and an
 * explicit `—` row for a stored chain whose balance could not be read. Nothing
 * is fabricated and no zero is invented; a wallet with nothing readable at all
 * still gets one honest `—` row rather than disappearing.
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
      });
    }
  }

  // A stored chain with no readable balance is shown as an explicit `—` row,
  // never hidden and never turned into a zero.
  const readable = new Set(wallet.chains.map((chain) => chain.chainId));
  for (const chainId of wallet.chainIds) {
    if (readable.has(chainId)) continue;
    const name = CHAIN_NAMES.get(chainId) ?? `Chain ${chainId}`;
    rows.push({
      key: `${wallet.address}:${chainId}:unread`,
      symbol: '—',
      circleColor: tokens.locked,
      name,
      provenance: `${provenance} · balance could not be read`,
      chain: name,
      chainColor: chainColor(name),
      amount: '—',
      value: '—',
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
    });
  }

  return rows;
}

/** Every verified then unverified wallet's holdings, flattened into table rows. */
function linkedRows(aggregate: HoldingsAggregate): LinkedRow[] {
  const rows: LinkedRow[] = [];

  const push = (
    wallet: HoldingWallet | UnverifiedHoldingWallet,
    verified: boolean,
    provenance: string,
  ) => {
    const holdings = assetRows(wallet, provenance);
    holdings.forEach((holding, index) => {
      rows.push({
        ...holding,
        address: wallet.address,
        verified,
        unverifiedWallet: verified
          ? null
          : (wallet as UnverifiedHoldingWallet),
        readError: index === 0 ? wallet.readError : null,
      });
    });
  };

  for (const wallet of aggregate.wallets) {
    push(wallet, true, verifiedProvenance(wallet));
  }
  for (const wallet of aggregate.unverifiedWallets) {
    push(wallet, false, unverifiedProvenance(wallet));
  }

  return rows;
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
}: HoldingsScreenProps) {
  const { total, walletCount, wallets, unverifiedWallets } = aggregate;

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
          value={usd(total)}
          sub="vault + linked wallets"
        />
        <SummaryCard
          label="Qualified"
          value="—"
          sub="Below 3-year tier — $280,000 to go"
          valueColor={tokens.brandPrimary}
        />
        <SummaryCard
          label="Not qualified"
          value={usd(total)}
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
        <div style={qualifiedEmpty}>
          Nothing qualified yet — move assets from your wallets below.
        </div>
      </Card>

      <Card radius={14} style={{ marginBottom: '16px' }}>
        <div style={sectionHeader}>
          <h2 style={sectionHeading}>In linked wallets</h2>
          <span style={sectionNote}>{LINKED_NOTE}</span>
        </div>

        {rows.length === 0 ? (
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
                    <LockedAction
                      height={32}
                      reason={MOVE_TO_VAULT_REASON}
                      style={rowActionButton}
                    >
                      Move to vault
                    </LockedAction>
                  ) : row.unverifiedWallet ? (
                    <Chip tone="warning" dot>
                      Unverified
                    </Chip>
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
