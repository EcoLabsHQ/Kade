import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { StatCard } from '@/components/ui/StatCard';
import { tokens } from '@/components/ui/tokens';
import { chainColor } from '@/lib/wealth/chain-colors';
import { shortAddress, usd } from '@/lib/wealth/format';
import type { HoldingsAggregate } from '@/lib/wealth/holdings';
import type { EvmChainBalance } from '@/lib/wealth/types';

/**
 * Holdings — the aggregate over signature-verified linked wallets.
 *
 * Presentational only: it renders the aggregate and the per-wallet breakdown
 * that `aggregateHoldings` produced, and it is explicit that a pasted address
 * never appears here because it never entered the aggregate. The link/verify
 * panel is passed in as `linkPanel`, so this component stays free of the wallet
 * connection and signature machinery and can be rendered directly in tests.
 */
export interface HoldingsScreenProps {
  readonly aggregate: HoldingsAggregate;
  /** The ownership-proof link panel, injected so this stays presentational. */
  readonly linkPanel?: ReactNode;
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

export function HoldingsScreen({ aggregate, linkPanel }: HoldingsScreenProps) {
  const { total, walletCount, valuedCount, unvaluedCount, wallets } = aggregate;

  return (
    <div>
      <h1
        style={{
          margin: '0 0 6px',
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
          margin: '0 0 24px',
          color: tokens.muted,
          maxWidth: '66ch',
          textWrap: 'pretty',
        }}
      >
        Every wallet here was proven by signing a server-issued challenge.
        Balances are read from the same public provider used across the
        platform. A pasted address is registration-only and never contributes a
        holding: it cannot enter this total.
      </p>

      <div
        className="kade-grid-4"
        style={{ gap: '14px', marginBottom: '16px' }}
      >
        <StatCard
          label="Linked holdings"
          value={usd(total)}
          sub={
            walletCount === 0
              ? 'Link a wallet to begin'
              : `${walletCount} signed wallet${walletCount === 1 ? '' : 's'}`
          }
          valueColor={total > 0 ? tokens.ink : tokens.locked}
          highlight
        />
        <StatCard
          label="Signature-verified"
          value={String(valuedCount)}
          sub="Wallets with readable balances"
        />
        <StatCard
          label="Unvalued"
          value={String(unvaluedCount)}
          sub="Provider read failed — shown as —"
        />
        <StatCard
          label="Pasted addresses"
          value="Excluded"
          sub="Registration-only, never in Holdings"
          valueColor={tokens.muted}
        />
      </div>

      {linkPanel ? <div style={{ marginBottom: '16px' }}>{linkPanel}</div> : null}

      <Card radius={14}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: '12px',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>
            Linked wallets
          </h2>
          {walletCount > 0 ? (
            <Chip tone="success">Signature-verified</Chip>
          ) : null}
        </div>

        {walletCount === 0 ? (
          <p
            style={{
              margin: '12px 0 0',
              fontSize: '13.5px',
              color: tokens.muted,
            }}
          >
            No signed wallet is linked yet. Connect a wallet and sign the
            challenge to show its holdings. A pasted address will not appear
            here.
          </p>
        ) : (
          <div style={{ marginTop: '10px' }}>
            {wallets.map((wallet) => (
              <div
                key={wallet.address}
                style={{
                  borderTop: `1px solid ${tokens.border}`,
                  paddingTop: '12px',
                  marginTop: '12px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: '10px',
                  }}
                >
                  <span
                    title={wallet.address}
                    style={{
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    {shortAddress(wallet.address)}
                  </span>
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {wallet.readError
                      ? '—'
                      : wallet.usd === null
                        ? '—'
                        : usd(wallet.usd)}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '6px',
                    flexWrap: 'wrap',
                  }}
                >
                  <Chip tone="success" dot>
                    Signed
                  </Chip>
                  <span style={{ fontSize: '12px', color: tokens.muted }}>
                    Proof {formatVerifiedAt(wallet.verifiedAt)} · chains{' '}
                    {wallet.chainIds.join(', ')}
                  </span>
                </div>

                {wallet.chains.map(chainRow)}

                <div
                  style={{
                    fontSize: '12px',
                    color: tokens.muted,
                    marginTop: '6px',
                  }}
                >
                  Balances read from a public source. The signature proves
                  control of this address; it is not a login and gives Kade no
                  authority over your Safe.
                </div>
                {wallet.readError ? (
                  <div
                    role="alert"
                    style={{
                      marginTop: '6px',
                      fontSize: '12.5px',
                      color: tokens.danger,
                    }}
                  >
                    {wallet.readError}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>

      <p
        style={{
          margin: '16px 0 0',
          fontSize: '12.5px',
          color: tokens.muted,
          lineHeight: 1.6,
          maxWidth: '66ch',
        }}
      >
        Pasted Bitcoin and EVM addresses are read-only proof of wealth for
        pre-registration. They are stored without a signature
        (<code>verified_at</code> is NULL) and are structurally excluded from
        this screen&rsquo;s aggregate.
      </p>
    </div>
  );
}
