'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppKit, useAppKitAccount } from '@reown/appkit/react';
import { useAccount, useDisconnect } from 'wagmi';
import { readAddressBalances } from '@/app/onboarding/wallet-actions';
import { Card } from '@/components/ui/Card';
import { tokens } from '@/components/ui/tokens';
import { WalletConnectGlyph } from '@/components/icons/WalletConnectGlyph';
import { WalletGlyph } from '@/components/icons/WalletGlyph';
import { chainColor } from '@/lib/wealth/chain-colors';
import { shortAddress, usd } from '@/lib/wealth/format';
import type { EvmChainBalance } from '@/lib/wealth/types';

/**
 * The two real wallet rows of the proof-of-wealth step.
 *
 * Browser extension and WalletConnect both open the Reown AppKit modal, which
 * is the connection package already installed for the fee rail. Nothing here is
 * mocked: the balance of the connected account is read from the same public
 * provider (Blockscout, on Ethereum and Base) that a pasted address uses, so the
 * two paths cannot disagree.
 *
 * The connection is used only to **read**. It confers no authority over the
 * resident Safe, and it is not proof the server can verify: the address comes
 * from the browser, so the screen says the balances were read from a public
 * source rather than claiming verified ownership.
 *
 * Every AppKit and wagmi hook lives in `ConfiguredWalletPanel`, which is mounted
 * only when a WalletConnect project id is configured and `WalletProvider` has
 * therefore mounted a `WagmiProvider`. Calling those hooks without a provider
 * throws, and the route has no error boundary, so the unconfigured environment
 * renders `UnconfiguredWalletPanel` instead: pure static markup with no hooks,
 * an honest "not configured" notice, and no way to reach a modal that does not
 * exist.
 */

/** What the panel reports upward, so the step can count it. */
export interface ConnectedWalletState {
  readonly address: string;
  readonly method: string;
  readonly chains: readonly EvmChainBalance[];
  readonly usd: number | null;
  readonly readError: string | null;
}

export interface ConnectedWalletPanelProps {
  /** False when no WalletConnect project id is configured. */
  readonly configured: boolean;
  readonly onChange: (state: ConnectedWalletState | null) => void;
}

const ROWS = [
  {
    key: 'extension',
    title: 'Browser extension',
    subtitle: 'MetaMask, Rabby · EVM',
    Glyph: WalletGlyph,
    background: '#E8831D',
  },
  {
    key: 'walletconnect',
    title: 'WalletConnect',
    subtitle: 'Scan with a mobile wallet',
    Glyph: WalletConnectGlyph,
    background: '#3B99FC',
  },
] as const;

function totalUsd(chains: readonly EvmChainBalance[]): number | null {
  const values = chains
    .map((chain) => chain.usd)
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

export function ConnectedWalletPanel({
  configured,
  onChange,
}: ConnectedWalletPanelProps) {
  // Gate the hooks on configuration, exactly as FeeStep gates FeePayment on
  // `paymentConfigured`: a component that calls the wallet hooks is never
  // mounted unless WagmiProvider/createAppKit are actually present.
  if (!configured) return <UnconfiguredWalletPanel />;
  return <ConfiguredWalletPanel onChange={onChange} />;
}

/**
 * A single wallet row. Presentational only: it holds no wallet state and calls
 * no hooks, so it can be rendered on both the configured and unconfigured path.
 */
function WalletRow({
  row,
  subtitle,
  action,
}: Readonly<{
  row: (typeof ROWS)[number];
  subtitle: string;
  action: ReactNode;
}>) {
  return (
    <Card padding="14px 16px">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span
          aria-hidden
          style={{ ...badgeStyle, background: row.background }}
        >
          <row.Glyph size={22} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>{row.title}</div>
          <div style={{ fontSize: '13px', color: tokens.muted }}>{subtitle}</div>
        </div>
        {action}
      </div>
    </Card>
  );
}

/**
 * The unconfigured path: static markup only.
 *
 * It renders no AppKit or wagmi hook, so it cannot throw when there is no
 * `WagmiProvider`, and the Connect buttons are disabled rather than opening a
 * modal that was never created.
 */
function UnconfiguredWalletPanel() {
  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      {ROWS.map((row) => (
        <WalletRow
          key={row.key}
          row={row}
          subtitle={row.subtitle}
          action={
            <button
              type="button"
              disabled
              title="Wallet connection is not configured in this environment."
              style={{
                ...connectButton,
                opacity: 0.5,
                cursor: 'not-allowed',
              }}
            >
              Connect
            </button>
          }
        />
      ))}

      <div style={mutedNote}>
        Wallet connection is not configured in this environment. Paste an
        address instead — its balance is still read from a public source.
      </div>
    </div>
  );
}

/** The configured path: the only place the AppKit and wagmi hooks are called. */
function ConfiguredWalletPanel({
  onChange,
}: Readonly<{ onChange: (state: ConnectedWalletState | null) => void }>) {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { connector } = useAccount();
  const { disconnect } = useDisconnect();

  const [chains, setChains] = useState<readonly EvmChainBalance[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  // Keep the latest callback without re-running the read effect on every render
  // of the parent, which would re-read the provider in a loop.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const method = connector?.name ?? 'Wallet';
  const usesWalletConnect = /walletconnect/i.test(
    `${connector?.id ?? ''} ${method}`,
  );

  useEffect(() => {
    if (!isConnected || !address) {
      setChains([]);
      setReadError(null);
      setReading(false);
      onChangeRef.current(null);
      return;
    }

    let active = true;
    setReading(true);
    setReadError(null);
    readAddressBalances(address)
      .then((record) => {
        if (!active) return;
        setChains(record.chains);
        setReadError(record.readError);
        onChangeRef.current({
          address: record.address,
          method,
          chains: record.chains,
          usd: record.usd,
          readError: record.readError,
        });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        const message =
          cause instanceof Error
            ? cause.message
            : 'The wallet balances could not be read.';
        setChains([]);
        setReadError(message);
        onChangeRef.current({
          address,
          method,
          chains: [],
          usd: null,
          readError: message,
        });
      })
      .finally(() => {
        if (active) setReading(false);
      });

    return () => {
      active = false;
    };
  }, [isConnected, address, method]);

  function connect(key: (typeof ROWS)[number]['key']) {
    if (key === 'extension') {
      // The connector list: the browser wallets the visitor already has.
      void open({ view: 'Connect' });
      return;
    }
    // AppKit has no dedicated WalletConnect view; the all-wallets list is where
    // WalletConnect (and its QR) lives, so this row opens straight into it.
    void open({ view: 'AllWallets' });
  }

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      {ROWS.map((row) => {
        const isThisMethod = !usesWalletConnect
          ? row.key === 'extension'
          : row.key === 'walletconnect';
        const connectedHere = isConnected && isThisMethod;

        return (
          <WalletRow
            key={row.key}
            row={row}
            subtitle={connectedHere && address ? address : row.subtitle}
            action={
              connectedHere ? (
                <button
                  type="button"
                  onClick={() => disconnect()}
                  style={connectButton}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => connect(row.key)}
                  title={`Connect with ${row.title}`}
                  style={connectButton}
                >
                  Connect
                </button>
              )
            }
          />
        );
      })}

      {isConnected && address ? (
        <Card padding="14px 16px">
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <span
              title={address}
              style={{
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: '13px',
                fontWeight: 600,
              }}
            >
              {shortAddress(address)}
            </span>
            <span
              style={{
                fontSize: '14px',
                fontWeight: 600,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {reading ? '…' : readError ? '—' : usd(totalUsd(chains) ?? 0)}
            </span>
          </div>

          {chains.map((chain) => (
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
          ))}

          <div style={{ ...mutedNote, marginTop: '6px' }}>
            Connected as {method}. Balances are read from a public source on
            Ethereum and Base, are not proof of ownership, and the connection
            gives Kade no authority over your Safe.
          </div>
          {readError ? (
            <div role="alert" style={errorText}>
              {readError}
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

const badgeStyle: React.CSSProperties = {
  width: '38px',
  height: '38px',
  borderRadius: '10px',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 auto',
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

const mutedNote: React.CSSProperties = {
  fontSize: '11.5px',
  color: tokens.muted,
  lineHeight: 1.5,
  margin: 0,
};

const errorText: React.CSSProperties = {
  marginTop: '6px',
  fontSize: '12.5px',
  color: tokens.danger,
};
