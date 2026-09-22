'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppKit } from '@reown/appkit/react';
import { useConnections, useDisconnect } from 'wagmi';
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
 * mocked: the balance of each connected account is read from the same public
 * provider (Blockscout, on Ethereum and Base) that a pasted address uses, so the
 * two paths cannot disagree.
 *
 * AppKit exposes only the active account through `useAppKitAccount`, but the
 * underlying wagmi config keeps a map of live connections, one per connector
 * (`@wagmi/core` `connect`/`disconnect` and `useConnections`). The panel reads
 * that map, so connecting a second method ADDS to the list instead of replacing
 * the first: both connections stay live and both balances are counted. A wallet
 * leaves the list only when its Disconnect button is clicked, even if the
 * underlying connector has already dropped on its own.
 *
 * The same address connected twice, or connected and also pasted, is one wallet:
 * the reported list is deduplicated by address so nothing is summed twice.
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
  /** The distinct connected wallets; null when none is connected. */
  readonly onChange: (states: readonly ConnectedWalletState[] | null) => void;
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

/** One live wagmi connection, as `useConnections` reports it. */
type WalletConnection = ReturnType<typeof useConnections>[number];

/** A connected wallet the panel tracks until it is explicitly disconnected. */
interface WalletEntry {
  readonly uid: string;
  readonly address: string;
  readonly method: string;
  readonly usesWalletConnect: boolean;
  readonly connector: WalletConnection['connector'];
  readonly chains: readonly EvmChainBalance[];
  readonly usd: number | null;
  readonly readError: string | null;
  readonly reading: boolean;
}

function totalUsd(chains: readonly EvmChainBalance[]): number | null {
  const values = chains
    .map((chain) => chain.usd)
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

/** WalletConnect is the only connector whose name/id is not an injected wallet. */
function usesWalletConnectConnector(
  connector: WalletConnection['connector'],
): boolean {
  return /walletconnect/i.test(`${connector.id ?? ''} ${connector.name ?? ''}`);
}

/**
 * Collapse wallets that share an address. The first occurrence wins, so a
 * connection found for an address shadows a second connection to the same one.
 */
function dedupeByAddress(entries: readonly WalletEntry[]): WalletEntry[] {
  const seen = new Set<string>();
  const distinct: WalletEntry[] = [];
  for (const entry of entries) {
    const key = entry.address.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(entry);
  }
  return distinct;
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
}: Readonly<{ onChange: (states: readonly ConnectedWalletState[] | null) => void }>) {
  const { open } = useAppKit();
  const connections = useConnections();
  const { disconnect } = useDisconnect();

  // The list is latched: connections are added as wagmi reports them and are
  // removed only by an explicit Disconnect, so a wallet that the browser drops
  // on its own stays visible (and counted) until the resident removes it.
  const [wallets, setWallets] = useState<readonly WalletEntry[]>([]);

  // Keep the latest callback without re-running the report effect on every
  // render of the parent, which would re-read the provider in a loop.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // One read per connector, even across effect re-runs.
  const readsInFlight = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  // Add every live connection (and address changes) to the list. It never
  // removes here: removal is the Disconnect button's job.
  useEffect(() => {
    setWallets((current) => {
      const byUid = new Map(current.map((entry) => [entry.uid, entry]));
      let changed = false;
      for (const connection of connections) {
        const address = connection.accounts[0];
        if (!address) continue;
        const uid = connection.connector.uid;
        const existing = byUid.get(uid);
        if (!existing) {
          byUid.set(uid, {
            uid,
            address,
            method: connection.connector.name ?? 'Wallet',
            usesWalletConnect: usesWalletConnectConnector(connection.connector),
            connector: connection.connector,
            chains: [],
            usd: null,
            readError: null,
            reading: true,
          });
          changed = true;
        } else if (existing.address !== address) {
          byUid.set(uid, {
            ...existing,
            address,
            chains: [],
            usd: null,
            readError: null,
            reading: true,
          });
          changed = true;
        }
      }
      return changed ? [...byUid.values()] : current;
    });
  }, [connections]);

  // Read the balance of every wallet that still needs one, from the same public
  // provider a pasted address uses. A read failure becomes that wallet's
  // `readError` rather than dropping it from the list.
  useEffect(() => {
    for (const wallet of wallets) {
      if (!wallet.reading || readsInFlight.current.has(wallet.uid)) continue;
      readsInFlight.current.add(wallet.uid);
      readAddressBalances(wallet.address)
        .then((record) => {
          if (!mounted.current) return;
          setWallets((current) =>
            current.map((entry) =>
              entry.uid === wallet.uid
                ? {
                    ...entry,
                    chains: record.chains,
                    usd: record.usd,
                    readError: record.readError,
                    reading: false,
                  }
                : entry,
            ),
          );
        })
        .catch((cause: unknown) => {
          if (!mounted.current) return;
          const message =
            cause instanceof Error
              ? cause.message
              : 'The wallet balances could not be read.';
          setWallets((current) =>
            current.map((entry) =>
              entry.uid === wallet.uid
                ? {
                    ...entry,
                    chains: [],
                    usd: null,
                    readError: message,
                    reading: false,
                  }
                : entry,
            ),
          );
        })
        .finally(() => {
          readsInFlight.current.delete(wallet.uid);
        });
    }
  }, [wallets]);

  // Report the deduplicated list upward. An empty list is reported as null, the
  // "nothing is connected" shape the step already understood.
  useEffect(() => {
    const reported = dedupeByAddress(wallets).map((entry) => ({
      address: entry.address,
      method: entry.method,
      chains: entry.chains,
      usd: entry.usd,
      readError: entry.readError,
    }));
    onChangeRef.current(reported.length > 0 ? reported : null);
  }, [wallets]);

  function connect(key: (typeof ROWS)[number]['key']) {
    if (key === 'extension') {
      // The connector list: the browser wallets the visitor already has.
      void open({ view: 'Connect' });
      return;
    }
    // `ConnectingWalletConnectBasic` is the dedicated WalletConnect QR view, so
    // this row opens the QR directly instead of the generic all-wallets list.
    void open({ view: 'ConnectingWalletConnectBasic' });
  }

  // Remove one method's wallets from the list and tear down any that are still
  // live. A wallet that the browser already dropped is removed without a call:
  // the click is still what takes it off the screen.
  function disconnectMethod(usesWalletConnect: boolean) {
    const targets = wallets.filter(
      (entry) => entry.usesWalletConnect === usesWalletConnect,
    );
    const activeUids = new Set(
      connections.map((connection) => connection.connector.uid),
    );
    setWallets((current) =>
      current.filter(
        (entry) => entry.usesWalletConnect !== usesWalletConnect,
      ),
    );
    for (const target of targets) {
      if (activeUids.has(target.uid)) {
        disconnect({ connector: target.connector });
      }
    }
  }

  const reported = dedupeByAddress(wallets);

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      {ROWS.map((row) => {
        const rowWalletConnect = row.key === 'walletconnect';
        const rowWallets = wallets.filter(
          (entry) => entry.usesWalletConnect === rowWalletConnect,
        );
        const connectedHere = rowWallets.length > 0;

        return (
          <WalletRow
            key={row.key}
            row={row}
            subtitle={
              connectedHere
                ? rowWallets.map((entry) => entry.address).join(', ')
                : row.subtitle
            }
            action={
              connectedHere ? (
                <button
                  type="button"
                  onClick={() => disconnectMethod(rowWalletConnect)}
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

      {reported.map((wallet) => (
        <Card key={wallet.address} padding="14px 16px">
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
              {wallet.reading
                ? '…'
                : wallet.readError
                  ? '—'
                  : usd(totalUsd(wallet.chains) ?? 0)}
            </span>
          </div>

          {wallet.chains.map((chain) => (
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
            Connected as {wallet.method}. Balances are read from a public source
            on Ethereum and Base, are not proof of ownership, and the connection
            gives Kade no authority over your Safe.
          </div>
          {wallet.readError ? (
            <div role="alert" style={errorText}>
              {wallet.readError}
            </div>
          ) : null}
        </Card>
      ))}
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
