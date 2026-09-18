'use client';

import { Card } from '@/components/ui/Card';
import { tokens } from '@/components/ui/tokens';

/**
 * Step 3 — proof of wealth.
 *
 * DEMO ONLY. Connecting a wallet here does not touch a chain: it attaches the
 * balances the reference ships as seed data, and the screen says so. Real wallet
 * connection and balance reads are Week 2 work (the Week 1 contract excludes
 * external wallet connection), so nothing here claims to have read anything.
 */
export interface MockWallet {
  readonly key: string;
  readonly name: string;
  readonly subtitle: string;
  readonly badge: string;
  readonly color: string;
  readonly assets: string;
  readonly value: number;
}

export const MOCK_WALLETS: readonly MockWallet[] = [
  {
    key: 'ext',
    name: 'Browser extension',
    subtitle: 'MetaMask, Rabby · EVM',
    badge: 'EXT',
    color: '#E8831D',
    assets: '25 ETH',
    value: 49575,
  },
  {
    key: 'wc',
    name: 'WalletConnect',
    subtitle: 'Scan with a mobile wallet',
    badge: 'WC',
    color: '#3B99FC',
    assets: '150,000 USDC',
    value: 150000,
  },
  {
    key: 'hw',
    name: 'Hardware wallet',
    subtitle: 'Ledger, Trezor · EVM',
    badge: 'HW',
    color: '#101828',
    assets: '48,900 USDY',
    value: 50000,
  },
  {
    key: 'btc',
    name: 'Bitcoin',
    subtitle: 'Watch-only xpub · Sparrow, Ledger',
    badge: 'BTC',
    color: '#F7931A',
    assets: '3.2 BTC',
    value: 203216,
  },
];

export interface WealthStepProps {
  readonly connected: readonly string[];
  readonly onConnect: (key: string) => void;
  readonly onContinue: () => void;
  /** The tier the resident selected in step 2, for the progress target. */
  readonly tierName: string;
  readonly tierMinimum: number;
}

function usd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function WealthStep({
  connected,
  onConnect,
  onContinue,
  tierName,
  tierMinimum,
}: WealthStepProps) {
  const linked = MOCK_WALLETS.filter((wallet) => connected.includes(wallet.key));
  const total = linked.reduce((sum, wallet) => sum + wallet.value, 0);
  const shortfall = Math.max(0, tierMinimum - total);
  const progress = Math.min(100, (total / 850000) * 100);
  const targetMark = Math.min(100, (tierMinimum / 850000) * 100);

  return (
    <div style={{ animation: 'fadeUp .2s ease-out' }}>
      <div style={eyebrow}>Step 3 of 4</div>
      <h1 style={heading}>Show proof of wealth</h1>
      <p style={lead}>
        One signature per wallet reads your balances on Ethereum, Base, Arbitrum,
        Optimism and Celo — nothing moves. This only shows you can meet the tier;
        moving funds into a qualified vault happens inside the platform.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)',
          gap: '16px',
          alignItems: 'start',
          maxWidth: '920px',
        }}
      >
        <div style={{ display: 'grid', gap: '10px' }}>
          {MOCK_WALLETS.map((wallet) => {
            const isConnected = connected.includes(wallet.key);
            return (
              <Card key={wallet.key} padding="14px 16px">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span
                    aria-hidden
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '10px',
                      background: wallet.color,
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                      flex: '0 0 auto',
                    }}
                  >
                    {wallet.badge}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>
                      {wallet.name}
                    </div>
                    <div style={{ fontSize: '12px', color: tokens.muted }}>
                      {wallet.subtitle}
                    </div>
                  </div>
                  {isConnected ? (
                    <span style={{ fontSize: '12px', fontWeight: 600, color: tokens.success }}>
                      Connected
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onConnect(wallet.key)}
                      style={connectButton}
                    >
                      Connect
                    </button>
                  )}
                </div>
                {isConnected ? (
                  <div
                    style={{
                      marginTop: '10px',
                      fontSize: '12px',
                      color: tokens.muted,
                    }}
                  >
                    {wallet.assets} · {usd(wallet.value)}{' '}
                    <span style={{ color: tokens.warning }}>· demo balance</span>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>

        <Card padding="18px 20px">
          <div style={eyebrow}>Proof of wealth</div>
          <div
            style={{
              marginTop: '8px',
              fontSize: '30px',
              fontWeight: 700,
              color: total > 0 ? tokens.ink : tokens.locked,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {usd(total)}
          </div>
          <div style={{ fontSize: '12.5px', color: tokens.muted, marginTop: '4px' }}>
            {linked.length === 0
              ? 'Connect a wallet to begin'
              : `${linked.length} wallet${linked.length === 1 ? '' : 's'} · demo balances`}
          </div>

          <div
            style={{
              position: 'relative',
              height: '6px',
              borderRadius: '999px',
              background: tokens.border,
              marginTop: '16px',
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                borderRadius: '999px',
                background: shortfall === 0 ? tokens.success : tokens.action,
              }}
            />
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: `calc(${targetMark}% - 1px)`,
                top: '-3px',
                width: '2px',
                height: '12px',
                background: tokens.ink,
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '8px',
              fontSize: '12px',
              color: tokens.muted,
            }}
          >
            <span>Target · {tierName}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {usd(tierMinimum)}
            </span>
          </div>

          <div
            style={{
              marginTop: '10px',
              fontSize: '13px',
              fontWeight: 600,
              color: shortfall === 0 ? tokens.success : tokens.warning,
            }}
          >
            {shortfall === 0
              ? `${tierName} tier met`
              : `${usd(shortfall)} short of ${tierName} tier`}
          </div>

          <p
            style={{
              margin: '14px 0 0',
              fontSize: '11.5px',
              color: tokens.muted,
              lineHeight: 1.6,
            }}
          >
            One signature covers every EVM chain — balances are read on Ethereum,
            Base, Arbitrum, Optimism and Celo. Bitcoin via watch-only xpub.
          </p>
        </Card>
      </div>

      <div style={{ marginTop: '22px' }}>
        <button
          type="button"
          disabled={linked.length === 0}
          onClick={onContinue}
          title={
            linked.length === 0
              ? 'Connect a wallet to continue'
              : 'Continue to the pre-approval fee'
          }
          style={{
            ...primaryButton,
            background: linked.length === 0 ? tokens.locked : tokens.action,
            cursor: linked.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

const eyebrow: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const heading: React.CSSProperties = {
  margin: '8px 0 6px',
  fontSize: '30px',
  fontWeight: 700,
  letterSpacing: '-.02em',
};

const lead: React.CSSProperties = {
  margin: '0 0 24px',
  color: tokens.muted,
  maxWidth: '62ch',
  textWrap: 'pretty',
};

const connectButton: React.CSSProperties = {
  height: '34px',
  padding: '0 16px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  fontFamily: 'inherit',
  fontSize: '12.5px',
  fontWeight: 600,
  cursor: 'pointer',
  flex: '0 0 auto',
};

const primaryButton: React.CSSProperties = {
  height: '46px',
  padding: '0 22px',
  border: 0,
  borderRadius: '999px',
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
};
