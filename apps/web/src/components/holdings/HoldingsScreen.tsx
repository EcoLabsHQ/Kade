'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { LockedAction } from '@/components/ui/LockedAction';
import { StatCard } from '@/components/ui/StatCard';
import { tokens } from '@/components/ui/tokens';
import { chainColor } from '@/lib/wealth/chain-colors';
import { shortAddress, usd } from '@/lib/wealth/format';
import type {
  HoldingWallet,
  HoldingsAggregate,
  UnverifiedHoldingWallet,
} from '@/lib/wealth/holdings';
import {
  CONNECTED_WALLET_PROVIDER,
  EVM_PROVIDER,
  type EvmChainBalance,
} from '@/lib/wealth/types';

/**
 * Holdings — the design reference's layout over **real data only**.
 *
 * The screen renders the aggregate `aggregateHoldings` produced: the four
 * summary cards, the per-chain totals over the signature-verified wallets, the
 * qualified-vault section, and the reference's single "In linked wallets" list.
 * That list shows **every** wallet — a signed row (counted in the total) and an
 * unsigned row (`connected-wallet` or `pasted-address`, carrying its provenance
 * and excluded from the total) side by side, each with its own action.
 *
 * Truthfulness rules honoured here:
 *
 *  - "Qualified", "Vault lock" and the qualified-vault section show the real
 *    state: KadeLock is not deployed (week-2 §4.3), so there is no qualified
 *    quantity, no lock date, no threshold and no yield. Where the reference
 *    shows a value we cannot produce, the screen says so instead of inventing
 *    one.
 *  - "Balances by chain" says, and renders, only the chains we actually read:
 *    Ethereum and Base. The reference's Arbitrum/Optimism/Celo are omitted.
 *  - "Move to vault" needs a Safe transaction from the passkey signer, which is
 *    not deployed (EXE-011), and the qualified vault itself is beyond Week 2
 *    (§4.3), so the action is rendered locked with that real reason.
 *  - Reflect/USDT+ is a feature that does not exist in Week 2; its card is
 *    rendered as explicitly unavailable, never functional.
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
   * Renders the per-row "Connect & sign" affordance for an unverified wallet.
   * Injected because proving control needs the wallet connection and signature
   * machinery; when omitted, the row still shows its provenance and exclusion.
   */
  readonly renderConnectSign?: (
    wallet: UnverifiedHoldingWallet,
  ) => ReactNode;
  /**
   * Renders the "+ Link another wallet" action. Injected because it connects a
   * wallet and persists the address through a server action.
   */
  readonly renderLinkAnother?: () => ReactNode;
}

/**
 * The chains this app actually reads for EVM balances. The reference lists five;
 * Week 2 covers Ethereum and Base only (week-2 §4.3), so the section renders
 * only those two and says so.
 */
const READ_CHAINS = [
  { chainId: 1, name: 'Ethereum' },
  { chainId: 8453, name: 'Base' },
] as const;

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

/** The resident-facing name of an unverified row's provenance. */
function provenanceLabel(provider: string): string {
  switch (provider) {
    case CONNECTED_WALLET_PROVIDER:
      return 'Connected wallet';
    case EVM_PROVIDER:
      return 'Pasted address';
    default:
      return provider;
  }
}

/** The honest sub-line for a chain card. Never a fabricated value. */
function chainSub(total: ChainTotal): string {
  if (total.usd !== null) {
    // The figure is the sum of the readable reads, so say how many wallets
    // actually contributed it rather than how many have a stored row.
    return `Read-only · ${total.valued} wallet${total.valued === 1 ? '' : 's'}`;
  }
  return total.wallets === 0
    ? 'No verified wallet on this chain'
    : 'Balance could not be read';
}

function formatVerifiedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function chainRow(chain: EvmChainBalance) {
  return (
    <div
      key={chain.chainId}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '6px',
        fontSize: '13px',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '10px',
          height: '10px',
          borderRadius: '2px',
          background: chainColor(chain.name),
          flex: '0 0 auto',
        }}
      />
      <span style={{ color: tokens.muted }}>
        {chain.name} · {chain.nativeAmount} {chain.nativeSymbol}
        {chain.usdc ? ` · ${chain.usdc.amount} ${chain.usdc.symbol}` : ''}
      </span>
      <span
        style={{
          marginLeft: 'auto',
          fontVariantNumeric: 'tabular-nums',
          color: tokens.muted,
        }}
      >
        {chain.usd === null ? '—' : usd(chain.usd)}
      </span>
    </div>
  );
}

export function HoldingsScreen({
  aggregate,
  safeAddress,
  renderConnectSign,
  renderLinkAnother,
}: HoldingsScreenProps) {
  const {
    total,
    walletCount,
    wallets,
    unverifiedWallets,
    unverifiedCount,
  } = aggregate;

  // The cards below speak about the **signed** set (their value is the verified
  // total), so a fallback must distinguish "nothing is linked yet" from "wallets
  // are linked but unsigned" — the list renders the latter.
  const linkedCount = walletCount + unverifiedCount;

  const chains = chainTotals(wallets);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: '24px',
          marginBottom: '24px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: '36px',
              lineHeight: 1.1,
              fontWeight: 700,
              letterSpacing: '-.02em',
            }}
          >
            Holdings
          </h1>
          <p
            style={{
              margin: '10px 0 0',
              color: tokens.muted,
              maxWidth: '64ch',
              textWrap: 'pretty',
            }}
          >
            Everything you hold in one place. Only assets inside the qualified
            vault count toward your permit. The qualified vault (KadeLock) is
            not deployed yet, so nothing is qualified and nothing counts toward
            a permit today.
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
        <StatCard
          label="Total holdings"
          value={usd(total)}
          sub={
            walletCount > 0
              ? `${walletCount} signature-verified wallet${walletCount === 1 ? '' : 's'}`
              : linkedCount > 0
                ? 'No signed wallet yet'
                : 'Link a wallet to begin'
          }
          valueColor={total > 0 ? tokens.ink : tokens.locked}
          highlight
        />
        <StatCard
          label="Qualified"
          value="—"
          sub="Qualified vault not deployed"
          valueColor={tokens.brandPrimary}
        />
        <StatCard
          label="Not qualified"
          value={usd(total)}
          sub={
            walletCount > 0
              ? 'proof of wealth · not counted'
              : linkedCount > 0
                ? 'No signed wallet yet'
                : 'No wallets linked yet'
          }
        />
        <StatCard
          label="Vault lock"
          value="—"
          sub="KadeLock not deployed — no lock date"
        />
      </div>

      <Card radius={14} style={{ marginBottom: '16px' }}>
        <div style={sectionHeader}>
          <h2 style={sectionHeading}>Balances by chain</h2>
          <span style={sectionNote}>Read from Ethereum and Base</span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '12px',
            marginTop: '16px',
          }}
        >
          {chains.map((chain) => (
            <div key={chain.chainId} style={chainCard}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span
                  aria-hidden
                  style={{
                    width: '9px',
                    height: '9px',
                    borderRadius: '2px',
                    background: chainColor(chain.name),
                    flex: '0 0 auto',
                  }}
                />
                <span style={{ fontSize: '12.5px', fontWeight: 600 }}>
                  {chain.name}
                </span>
              </div>
              <div
                style={{
                  fontSize: '19px',
                  fontWeight: 700,
                  marginTop: '8px',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {chain.usd === null ? '—' : usd(chain.usd)}
              </div>
              <div
                style={{
                  fontSize: '11.5px',
                  color: tokens.muted,
                  marginTop: '2px',
                }}
              >
                {chainSub(chain)}
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
          <span style={sectionNote}>Ethereum · Base · KadeLock not deployed</span>
        </div>
        <div
          style={{
            padding: '22px 0',
            textAlign: 'center',
            fontSize: '13px',
            color: tokens.muted,
          }}
        >
          Nothing qualified yet — move assets from your wallets below.
        </div>
        <p style={bodyNote}>
          The qualified vault (KadeLock) is not deployed in Week 2, so no asset
          can be moved in or qualified. There is no qualified quantity, lock
          date, threshold or yield to show yet.
        </p>
      </Card>

      <Card radius={14}>
        <div style={sectionHeader}>
          <h2 style={sectionHeading}>In linked wallets</h2>
          <span style={sectionNote}>
            Proof of wealth · signed rows count in the total
          </span>
        </div>
        <p style={{ ...bodyNote, marginTop: '10px' }}>
          Every wallet you have added, signed or not. A signed row is counted in
          the total above; an unsigned row is marked unverified, carries its
          provenance, and is <strong>excluded from the total</strong> until the
          wallet that controls it signs. Only a signed wallet can move funds to
          the vault.
        </p>

        {walletCount + unverifiedCount === 0 ? (
          <p style={emptyNote}>
            No wallets linked yet. Use + Link another wallet to add one.
          </p>
        ) : (
          <div style={{ marginTop: '10px' }}>
            {wallets.map((wallet) => (
              <div key={wallet.address} style={walletRow}>
                <div style={walletHeader}>
                  <span title={wallet.address} style={monoAddress}>
                    {shortAddress(wallet.address)}
                  </span>
                  <span style={amount}>
                    {wallet.readError
                      ? '—'
                      : wallet.usd === null
                        ? '—'
                        : usd(wallet.usd)}
                  </span>
                </div>

                <div style={chipRow}>
                  <Chip tone="success" dot>
                    Signed
                  </Chip>
                  <span style={meta}>
                    Proof {formatVerifiedAt(wallet.verifiedAt)} · chains{' '}
                    {wallet.chainIds.join(', ')}
                  </span>
                </div>

                {wallet.chains.map(chainRow)}

                <div style={actionRow}>
                  <span style={actionNote}>
                    Counted in the total above. The signature is not a login and
                    gives Kade no authority over your Safe.
                  </span>
                  <LockedAction
                    height={32}
                    reason="Moving funds to the vault needs a Safe transaction from your passkey signer. That signer contract (EXE-011) is not deployed, and the qualified vault (KadeLock) is beyond the Week 2 envelope (§4.3)."
                    style={rowActionButton}
                  >
                    Move to vault
                  </LockedAction>
                </div>
                {wallet.readError ? (
                  <div role="alert" style={errorText}>
                    {wallet.readError}
                  </div>
                ) : null}
              </div>
            ))}

            {unverifiedWallets.map((wallet) => (
              <div key={wallet.address} style={walletRow}>
                <div style={walletHeader}>
                  <span title={wallet.address} style={monoAddress}>
                    {shortAddress(wallet.address)}
                  </span>
                  <span style={amount}>
                    {wallet.readError
                      ? '—'
                      : wallet.usd === null
                        ? '—'
                        : usd(wallet.usd)}
                  </span>
                </div>

                <div style={chipRow}>
                  <Chip tone="warning" dot>
                    Unverified
                  </Chip>
                  <span style={meta}>
                    {provenanceLabel(wallet.provider)} · chains{' '}
                    {wallet.chainIds.join(', ')}
                  </span>
                </div>

                {wallet.chains.map(chainRow)}

                <div style={actionRow}>
                  <span style={actionNote}>
                    Read from a public source. Not evidence of control; excluded
                    from the total.
                  </span>
                  {renderConnectSign ? renderConnectSign(wallet) : null}
                </div>
                {wallet.readError ? (
                  <div role="alert" style={errorText}>
                    {wallet.readError}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        <div style={listFooter}>
          <span style={sectionNote}>
            {walletCount === 0
              ? 'No wallets signed yet'
              : `${walletCount} wallet${walletCount === 1 ? '' : 's'} signed · balances read-only`}
          </span>
          {renderLinkAnother ? renderLinkAnother() : null}
        </div>
      </Card>

      <Card radius={14} style={{ marginTop: '16px' }}>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: tokens.action,
          }}
        >
          Default USD vault · Reflect
        </div>
        <h2
          style={{
            margin: '8px 0 6px',
            fontSize: '22px',
            fontWeight: 700,
            letterSpacing: '-.01em',
          }}
        >
          Hold dollars as USDT+
        </h2>
        <p style={{ ...bodyNote, margin: 0 }}>
          Not available in Week 2. Reflect/USDT+ conversion and the vault that
          would hold it are outside the frozen scope (week-2 contract §9), so
          no conversion, rate or yield is offered here.
        </p>
        <div style={{ marginTop: '16px' }}>
          <LockedAction
            height={42}
            reason="Reflect/USDT+ conversion is out of Week 2 scope (week-2 contract §9)"
            style={{ width: '100%' }}
          >
            Convert to USDT+
          </LockedAction>
        </div>
      </Card>

      <p style={footer}>
        Balances are read from a public provider on Ethereum and Base only. A
        linked wallet is proven by signing a server-issued challenge; that
        signature is not a login and gives Kade no authority over your Safe. A
        connected wallet or a pasted EVM address is read-only, unverified and
        excluded from the total; a pasted Bitcoin address never feeds Holdings.
        The qualified vault (KadeLock) is not deployed in Week 2, so no asset is
        qualified and no tier, lock date or yield applies.
      </p>
    </div>
  );
}

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

const chainCard: CSSProperties = {
  background: '#fff',
  border: `1px solid ${tokens.border}`,
  borderRadius: '12px',
  padding: '13px 15px',
};

const bodyNote: CSSProperties = {
  fontSize: '12px',
  color: tokens.muted,
  marginTop: '8px',
  marginBottom: 0,
  lineHeight: 1.5,
};

const emptyNote: CSSProperties = {
  margin: '12px 0 0',
  fontSize: '13.5px',
  color: tokens.muted,
  maxWidth: '66ch',
};

const walletRow: CSSProperties = {
  borderTop: `1px solid ${tokens.border}`,
  paddingTop: '12px',
  marginTop: '12px',
};

const walletHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '10px',
  flexWrap: 'wrap',
};

const monoAddress: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '13px',
  fontWeight: 600,
};

const amount: CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
};

const chipRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginTop: '6px',
  flexWrap: 'wrap',
};

const meta: CSSProperties = {
  fontSize: '12px',
  color: tokens.muted,
};

const actionRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '10px',
  marginTop: '8px',
  flexWrap: 'wrap',
};

const actionNote: CSSProperties = {
  fontSize: '12px',
  color: tokens.muted,
  maxWidth: '58ch',
};

/** Sizing for the small per-row locked control, merged under `lockedStyle`. */
const rowActionButton: CSSProperties = {
  fontSize: '12.5px',
  padding: '0 14px',
};

const listFooter: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  marginTop: '16px',
  flexWrap: 'wrap',
};

const errorText: CSSProperties = {
  marginTop: '6px',
  fontSize: '12.5px',
  color: tokens.danger,
};

const footer: CSSProperties = {
  margin: '16px 0 0',
  fontSize: '12.5px',
  color: tokens.muted,
  lineHeight: 1.6,
  maxWidth: '66ch',
};
