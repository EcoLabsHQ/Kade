'use client';

import { TIERS } from '@kade/shared';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { tokens } from '@/components/ui/tokens';

/** The widest qualifying figure, used only to scale the progress track. */
const TIER_SCALE_MAX = Math.max(...TIERS.map((tier) => tier.minUsdc));

/**
 * Step 3 — show proof of wealth.
 *
 * DEMO ONLY. Connecting a wallet here touches no chain: it attaches the balances
 * the reference ships as seed data, the screen labels them as demo balances, and
 * the card ends up in the "Signed" state the reference shows. Real wallet
 * connection and balance reads are Week 2 (the Week 1 contract excludes external
 * wallet connection), so nothing claims to have read anything.
 */

const CHAIN_COLORS: Record<string, string> = {
  Ethereum: '#627EEA',
  Base: '#0052FF',
  Arbitrum: '#2D374B',
  Optimism: '#FF0420',
  Celo: '#FCFF52',
};

export interface MockChainBalance {
  readonly chain: keyof typeof CHAIN_COLORS | string;
  readonly amount: string;
  readonly value: number;
}

export interface MockWallet {
  readonly key: string;
  readonly name: string;
  readonly subtitle: string;
  readonly badge: string;
  readonly color: string;
  readonly address: string;
  readonly assets: string;
  readonly value: number;
  readonly chains: readonly MockChainBalance[];
}

export const MOCK_WALLETS: readonly MockWallet[] = [
  {
    key: 'ext',
    name: 'Browser extension',
    subtitle: 'MetaMask, Rabby · EVM',
    badge: 'EXT',
    color: '#E8831D',
    address: '0x71C9…2fA1',
    assets: '25 ETH across 5 chains',
    value: 49575,
    chains: [
      { chain: 'Ethereum', amount: '14.20 ETH', value: 28150 },
      { chain: 'Base', amount: '6.10 ETH', value: 12093 },
      { chain: 'Arbitrum', amount: '3.40 ETH', value: 6740 },
      { chain: 'Optimism', amount: '1.05 ETH', value: 2082 },
      { chain: 'Celo', amount: '0.25 ETH', value: 510 },
    ],
  },
  {
    key: 'wc',
    name: 'WalletConnect',
    subtitle: 'Scan with a mobile wallet',
    badge: 'WC',
    color: '#3B99FC',
    address: '0x3aD0…77b2',
    assets: '150,000 USDC across 5 chains',
    value: 150000,
    chains: [
      { chain: 'Ethereum', amount: '84,200 USDC', value: 84200 },
      { chain: 'Base', amount: '41,500 USDC', value: 41500 },
      { chain: 'Arbitrum', amount: '18,800 USDC', value: 18800 },
      { chain: 'Optimism', amount: '4,100 USDC', value: 4100 },
      { chain: 'Celo', amount: '1,400 USDC', value: 1400 },
    ],
  },
  {
    key: 'hw',
    name: 'Hardware wallet',
    subtitle: 'Ledger, Trezor · EVM',
    badge: 'HW',
    color: '#101828',
    address: '0x9E4b…c113',
    assets: '48,900 USDY across 2 chains',
    value: 50000,
    chains: [
      { chain: 'Ethereum', amount: '44,900 USDY', value: 45900 },
      { chain: 'Base', amount: '4,000 USDY', value: 4100 },
    ],
  },
  {
    key: 'btc',
    name: 'Bitcoin',
    subtitle: 'Watch-only xpub · Sparrow, Ledger',
    badge: 'BTC',
    color: '#F7931A',
    address: 'bc1q…8x2v',
    assets: '3.2 BTC',
    value: 203216,
    chains: [{ chain: 'Bitcoin', amount: '3.2 BTC', value: 203216 }],
  },
];

export interface WealthStepProps {
  readonly connected: readonly string[];
  readonly onConnect: (key: string) => void;
  readonly onContinue: () => void;
  readonly onBack: () => void;
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
  onBack,
  tierName,
  tierMinimum,
}: WealthStepProps) {
  const linked = MOCK_WALLETS.filter((wallet) => connected.includes(wallet.key));
  const total = linked.reduce((sum, wallet) => sum + wallet.value, 0);
  const shortfall = Math.max(0, tierMinimum - total);
  const progress = Math.min(100, (total / TIER_SCALE_MAX) * 100);
  const targetMark = Math.min(100, (tierMinimum / TIER_SCALE_MAX) * 100);

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
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.15fr)',
          gap: '16px',
          alignItems: 'start',
          maxWidth: '1160px',
        }}
      >
        <div style={{ display: 'grid', gap: '10px' }}>
          {MOCK_WALLETS.map((wallet) => {
            const isSigned = connected.includes(wallet.key);
            return (
              <Card key={wallet.key} padding="14px 16px">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span aria-hidden style={{ ...badgeStyle, background: wallet.color }}>
                    {wallet.badge}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '15px', fontWeight: 600 }}>
                      {wallet.name}
                    </div>
                    <div style={{ fontSize: '13px', color: tokens.muted }}>
                      {wallet.subtitle}
                    </div>
                  </div>
                  {isSigned ? (
                    <span style={signedStyle}>
                      <span style={signedDot} />
                      Signed
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
              </Card>
            );
          })}

          <div
            style={{
              border: `1px dashed ${tokens.border}`,
              borderRadius: '14px',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '15px', fontWeight: 600 }}>
                Bank statement (optional)
              </div>
              <div style={{ fontSize: '13px', color: tokens.muted }}>
                For off-chain assets · PDF, hashed &amp; pinned
              </div>
            </div>
            <button type="button" style={connectButton}>
              Upload
            </button>
          </div>
        </div>

        <Card padding="20px 22px">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div style={eyebrow}>Proof of wealth</div>
            <Chip tone="muted">Demo balances</Chip>
          </div>
          <div
            style={{
              marginTop: '10px',
              fontSize: '34px',
              fontWeight: 700,
              letterSpacing: '-.02em',
              color: total > 0 ? tokens.ink : tokens.locked,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {usd(total)}
          </div>
          <div style={{ fontSize: '13px', color: tokens.muted, marginTop: '4px' }}>
            {linked.length === 0
              ? 'Connect a wallet to begin'
              : `${linked.length} wallet${linked.length === 1 ? '' : 's'} · example balances`}
          </div>

          <div style={{ position: 'relative', marginTop: '18px' }}>
            <div style={trackStyle}>
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  borderRadius: '999px',
                  background: shortfall === 0 ? tokens.success : tokens.action,
                }}
              />
            </div>
            <span
              aria-hidden
              style={{ ...targetTickStyle, left: `calc(${targetMark}% - 1px)` }}
            />
          </div>

          <div style={targetRowStyle}>
            <span>Target · {tierName}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {usd(tierMinimum)}
            </span>
          </div>

          <div
            style={{
              marginTop: '12px',
              fontSize: '14px',
              fontWeight: 600,
              color: shortfall === 0 ? tokens.success : tokens.warning,
            }}
          >
            {shortfall === 0
              ? `${tierName} tier met`
              : `${usd(shortfall)} short of ${tierName} tier`}
          </div>

          {linked.map((wallet) => (
            <div key={wallet.key} style={{ marginTop: '18px' }}>
              <div
                style={{
                  borderTop: `1px solid ${tokens.border}`,
                  paddingTop: '14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <span style={{ fontSize: '14px', fontWeight: 600 }}>
                  {wallet.name}
                </span>
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {usd(wallet.value)}
                </span>
              </div>
              <div style={{ fontSize: '12.5px', color: tokens.muted, marginTop: '2px' }}>
                {wallet.address} · {wallet.assets}
              </div>
              {wallet.chains.map((chain) => (
                <div
                  key={chain.chain}
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
                      background: CHAIN_COLORS[chain.chain] ?? tokens.muted,
                      flex: '0 0 auto',
                    }}
                  />
                  <span style={{ color: tokens.muted }}>
                    {chain.chain} · {chain.amount}
                  </span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontVariantNumeric: 'tabular-nums',
                      color: tokens.muted,
                    }}
                  >
                    {usd(chain.value)}
                  </span>
                </div>
              ))}
            </div>
          ))}

          <p
            style={{
              margin: '18px 0 0',
              paddingTop: '14px',
              borderTop: `1px solid ${tokens.border}`,
              fontSize: '12.5px',
              color: tokens.muted,
              lineHeight: 1.6,
            }}
          >
            One signature covers every EVM chain — balances are read on Ethereum,
            Base, Arbitrum, Optimism and Celo. Bitcoin via watch-only xpub.
            Balances shown are demo data.
          </p>
        </Card>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
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
        <button type="button" onClick={onBack} style={secondaryButton}>
          Back
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

const badgeStyle: React.CSSProperties = {
  width: '38px',
  height: '38px',
  borderRadius: '10px',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '11px',
  fontWeight: 700,
  flex: '0 0 auto',
};

const signedStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '12.5px',
  fontWeight: 600,
  color: tokens.success,
  whiteSpace: 'nowrap',
};

const signedDot: React.CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: tokens.success,
};

const connectButton: React.CSSProperties = {
  height: '36px',
  padding: '0 16px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  fontFamily: 'inherit',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  flex: '0 0 auto',
};

const trackStyle: React.CSSProperties = {
  height: '7px',
  borderRadius: '999px',
  background: tokens.border,
  overflow: 'hidden',
};

const targetTickStyle: React.CSSProperties = {
  position: 'absolute',
  top: '-3px',
  width: '2px',
  height: '13px',
  background: tokens.ink,
};

const targetRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  marginTop: '8px',
  fontSize: '13px',
  color: tokens.muted,
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

const secondaryButton: React.CSSProperties = {
  height: '46px',
  padding: '0 22px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  color: tokens.ink,
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
};
