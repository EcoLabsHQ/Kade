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
 * qualified-vault section, the verified per-wallet breakdown, and one labelled
 * section for every unverified wallet (connected or pasted EVM) with its
 * provenance and a per-row Verify affordance.
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
 *  - Reflect/USDT+ and "Move to vault" are features that do not exist in Week 2;
 *    the Reflect card is rendered as explicitly unavailable, never functional.
 *
 * Presentational discipline: everything comes in as props. The wallet-connection
 * and signature machinery for the per-row Verify action is injected as
 * `renderVerify`, so this component renders without a wallet and its tests never
 * need one.
 */
export interface HoldingsScreenProps {
  readonly aggregate: HoldingsAggregate;
  /** The resident's Safe address from `safe_deployments`, or null/absent. */
  readonly safeAddress?: string | null;
  /** The ownership-proof link panel, injected so this stays presentational. */
  readonly linkPanel?: ReactNode;
  /**
   * Renders the per-row Verify affordance for an unverified wallet. Injected
   * because proving control needs the wallet connection and signature
   * machinery; when omitted, the row still shows its provenance and exclusion.
   */
  readonly renderVerify?: (wallet: UnverifiedHoldingWallet) => ReactNode;
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
  /** How many verified wallets have a stored row on this chain. */
  readonly wallets: number;
}

/**
 * Aggregate the signature-verified wallets' per-chain reads.
 *
 * Only chains we actually read are produced. A chain whose reads all failed (or
 * that no wallet has) keeps `usd: null`, so the card renders `—` rather than a
 * fabricated zero. This sums the same per-chain figures that feed the total, so
 * the chain cards reconstruct the total instead of contradicting it.
 */
function chainTotals(wallets: readonly HoldingWallet[]): ChainTotal[] {
  return READ_CHAINS.map(({ chainId, name }) => {
    let sum = 0;
    let valued = 0;
    let present = 0;
    for (const wallet of wallets) {
      for (const chain of wallet.chains) {
        if (chain.chainId !== chainId) continue;
        present += 1;
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
      wallets: present,
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
    return `Read-only · ${total.wallets} wallet${total.wallets === 1 ? '' : 's'}`;
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
  linkPanel,
  renderVerify,
}: HoldingsScreenProps) {
  const {
    total,
    walletCount,
    wallets,
    unverifiedWallets,
    unverifiedCount,
  } = aggregate;

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
            walletCount === 0
              ? 'Link a wallet to begin'
              : `${walletCount} signature-verified wallet${walletCount === 1 ? '' : 's'}`
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
            walletCount === 0
              ? 'No wallets linked yet'
              : 'proof of wealth · not counted'
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

      {linkPanel ? (
        <div style={{ marginBottom: '16px' }}>{linkPanel}</div>
      ) : null}

      <Card radius={14}>
        <div style={sectionHeader}>
          <h2 style={sectionHeading}>Linked wallets</h2>
          {walletCount > 0 ? (
            <Chip tone="success">Signature-verified</Chip>
          ) : null}
        </div>

        {walletCount === 0 ? (
          <p style={emptyNote}>
            No signed wallet is linked yet. Connect a wallet and sign the
            challenge to show its holdings. A pasted EVM address stays in
            Unverified wallets until its wallet signs.
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

                <p style={bodyNote}>
                  Balances read from a public source. The signature proves
                  control of this address; it is not a login and gives Kade no
                  authority over your Safe.
                </p>
                {wallet.readError ? (
                  <div role="alert" style={errorText}>
                    {wallet.readError}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      {unverifiedCount > 0 ? (
        <Card radius={14} style={{ marginTop: '16px' }}>
          <div style={sectionHeader}>
            <h2 style={sectionHeading}>Unverified wallets</h2>
            <Chip tone="warning">Unverified</Chip>
          </div>
          <p style={{ ...bodyNote, marginTop: '10px' }}>
            A connected wallet and a pasted EVM address, shown with their
            provenance. Neither is a signature, so neither is evidence of
            control; both are <strong>excluded from the total</strong> until
            the wallet that controls the address signs a challenge.
          </p>

          <div style={{ marginTop: '10px' }}>
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

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    marginTop: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: '12px', color: tokens.muted }}>
                    Read from a public source. Not evidence of control; excluded
                    from the total.
                  </span>
                  {renderVerify ? renderVerify(wallet) : null}
                </div>
                {wallet.readError ? (
                  <div role="alert" style={errorText}>
                    {wallet.readError}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

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
