'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppKit } from '@reown/appkit/react';
import { useConnections, useDisconnect } from 'wagmi';
import { readAddressBalances } from '@/app/onboarding/wallet-actions';
import { Card } from '@/components/ui/Card';
import { tokens } from '@/components/ui/tokens';
import { WalletConnectGlyph } from '@/components/icons/WalletConnectGlyph';
import { WalletGlyph } from '@/components/icons/WalletGlyph';
import { shortAddress } from '@/lib/wealth/format';
import {
  MAX_WALLET_ADDRESSES,
  type EvmChainBalance,
} from '@/lib/wealth/types';

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
 * When the step supplies `onSaveConnectedWallet`, a connected account is also
 * **saved** through the connected-wallet server action (`addConnectedWallet`),
 * then the connection is torn down: the saved row is what remains and the next
 * connect starts clean. The row is persisted with the distinct `connected-wallet`
 * provider and `verified_at` NULL, so it survives a reload and is shown in
 * Holdings as an unverified connected wallet, excluded from the total. A store
 * failure keeps the connection in place and surfaces the server's own message
 * (the 5-address cap, for example), so the resident is not left with a
 * half-saved wallet.
 *
 * The connection is used only to **read** (and, once saved, to hand the address
 * to that same read-only action). It confers no authority over the resident
 * Safe, and it is not proof the server can verify: the address comes from the
 * browser, so the screen says the balances were read from a public source
 * rather than claiming verified ownership.
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
  /**
   * Save a connected address as a persistence row through the connected-wallet
   * server action (`addConnectedWallet`), so it is stored with the distinct
   * `connected-wallet` provider and shown unverified in Holdings. When supplied,
   * a successful save tears the connection down so the panel returns to its
   * Connect state and the next connect starts clean; the saved row is what
   * remains. When omitted the panel only tracks live connections.
   */
  readonly onSaveConnectedWallet?: (address: string) => Promise<void> | void;
  /** True when the shared EVM-address cap is already reached. */
  readonly atCap?: boolean;
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
  onSaveConnectedWallet,
  atCap = false,
}: ConnectedWalletPanelProps) {
  // Gate the hooks on configuration, exactly as FeeStep gates FeePayment on
  // `paymentConfigured`: a component that calls the wallet hooks is never
  // mounted unless WagmiProvider/createAppKit are actually present.
  if (!configured) return <UnconfiguredWalletPanel />;
  return (
    <ConfiguredWalletPanel
      onChange={onChange}
      onSaveConnectedWallet={onSaveConnectedWallet}
      atCap={atCap}
    />
  );
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
          <div
            style={{
              fontSize: '13px',
              color: tokens.muted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subtitle}
          </div>
        </div>
        <div style={{ flex: '0 0 auto' }}>{action}</div>
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
  onSaveConnectedWallet,
  atCap,
}: Readonly<{
  onChange: (states: readonly ConnectedWalletState[] | null) => void;
  onSaveConnectedWallet?: (address: string) => Promise<void> | void;
  atCap: boolean;
}>) {
  const { open } = useAppKit();
  const connections = useConnections();
  const { disconnect } = useDisconnect();

  // The list is latched: connections are added as wagmi reports them and are
  // removed only by an explicit Disconnect, so a wallet that the browser drops
  // on its own stays visible (and counted) until the resident removes it.
  const [wallets, setWallets] = useState<readonly WalletEntry[]>([]);
  // A failed store is shown in place; a successful one leaves no trace here.
  const [storeError, setStoreError] = useState<string | null>(null);

  // Keep the latest callback without re-running the report effect on every
  // render of the parent, which would re-read the provider in a loop.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // The save handler is optional: without it the panel is the original
  // read-only tracker, with no write path. The ref keeps the effect below from
  // re-running when the parent passes a new closure.
  const addWalletAddressRef = useRef(onSaveConnectedWallet);
  addWalletAddressRef.current = onSaveConnectedWallet;

  const disconnectRef = useRef(disconnect);
  disconnectRef.current = disconnect;

  // Addresses already saved this session, keyed by connector and address, so a
  // connector wagmi still reports cannot be saved or shown a second time.
  const storedKeys = useRef(new Set<string>());

  // One read per connector, even across effect re-runs.
  const readsInFlight = useRef(new Set<string>());
  // Set on mount and cleared on unmount. StrictMode mounts, unmounts and
  // remounts the effect, so the flag must be set back to true on every mount;
  // leaving it false after the first cleanup discarded every balance read.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A ref mirror so the save path can report the settled list synchronously,
  // rather than depending on the report effect's re-run timing.
  const walletsRef = useRef<readonly WalletEntry[]>(wallets);
  walletsRef.current = wallets;

  // Report the deduplicated list upward. An empty list is reported as null, the
  // "nothing is connected" shape the step already understood.
  const report = useCallback((list: readonly WalletEntry[]) => {
    const reported = dedupeByAddress(list).map((entry) => ({
      address: entry.address,
      method: entry.method,
      chains: entry.chains,
      usd: entry.usd,
      readError: entry.readError,
    }));
    onChangeRef.current(reported.length > 0 ? reported : null);
  }, []);

  // Add every live connection (and address changes) to the list. It never
  // removes here: removal is the Disconnect button's job.
  useEffect(() => {
    // A wallet whose address is already saved must not be saved again; if the
    // resident reconnects it, tear the fresh connection down rather than leave
    // it live behind a panel that is back in its Connect state.
    for (const connection of connections) {
      const address = connection.accounts[0];
      if (!address) continue;
      const key = `${connection.connector.uid}:${address.toLowerCase()}`;
      if (storedKeys.current.has(key)) {
        disconnectRef.current({ connector: connection.connector });
      }
    }

    setWallets((current) => {
      const byUid = new Map(current.map((entry) => [entry.uid, entry]));
      let changed = false;
      for (const connection of connections) {
        const address = connection.accounts[0];
        if (!address) continue;
        const uid = connection.connector.uid;
        // A wallet already saved is not re-added: the saved row is its record.
        if (storedKeys.current.has(`${uid}:${address.toLowerCase()}`)) continue;
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
  //
  // When the step supplies a save handler, a completed read is also saved as a
  // watch-only row and the connection is then torn down. The save is attempted
  // once per read; a failure keeps the live row (and shows the server's
  // message) instead of silently losing the wallet.
  useEffect(() => {
    for (const wallet of wallets) {
      if (!wallet.reading || readsInFlight.current.has(wallet.uid)) continue;
      readsInFlight.current.add(wallet.uid);
      readAddressBalances(wallet.address)
        .then(async (record) => {
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

          const add = addWalletAddressRef.current;
          if (!add) return;
          try {
            await add(wallet.address);
          } catch (cause) {
            if (!mounted.current) return;
            setStoreError(
              cause instanceof Error
                ? cause.message
                : 'The address could not be saved as a watch-only row.',
            );
            return;
          }
          if (!mounted.current) return;
          // Saved. Drop the live entry and tear the connection down: the saved
          // row is what remains, and the next connect starts clean.
          storedKeys.current.add(
            `${wallet.uid}:${wallet.address.toLowerCase()}`,
          );
          setStoreError(null);
          disconnectRef.current({ connector: wallet.connector });
          // Drop the live entry and report the settled list in the same step, so
          // the parent's summary cannot observe a transient "still connected"
          // state while the report effect waits for the next render.
          const remaining = walletsRef.current.filter(
            (entry) => entry.uid !== wallet.uid,
          );
          setWallets(remaining);
          report(remaining);
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
  }, [wallets, report]);

  // Report the deduplicated list upward. An empty list is reported as null, the
  // "nothing is connected" shape the step already understood.
  useEffect(() => {
    report(wallets);
  }, [wallets, report]);

  function connect(key: (typeof ROWS)[number]['key']) {
    // A fresh attempt starts without the previous store's error on screen.
    setStoreError(null);
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

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      {ROWS.map((row) => {
        const rowWalletConnect = row.key === 'walletconnect';
        const rowWallets = wallets.filter(
          (entry) => entry.usesWalletConnect === rowWalletConnect,
        );
        const connectedHere = rowWallets.length > 0;
        // With a save handler the panel reads the balance, saves the address and
        // then tears the connection down itself, so a live wallet shows a
        // disabled Connect rather than a manual Disconnect. A failed save keeps
        // the connection live, so the manual control returns for recovery.
        const awaitingSave =
          connectedHere && onSaveConnectedWallet !== undefined && !storeError;
        const needsManualDisconnect = connectedHere && !awaitingSave;

        return (
          <WalletRow
            key={row.key}
            row={row}
            subtitle={
              connectedHere
                ? rowWallets.map((entry) => shortAddress(entry.address)).join(', ')
                : row.subtitle
            }
            action={
              needsManualDisconnect ? (
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
                  onClick={awaitingSave ? undefined : () => connect(row.key)}
                  disabled={awaitingSave || atCap}
                  title={
                    awaitingSave
                      ? 'Reading the balance, saving the address and disconnecting for you.'
                      : atCap
                        ? `Up to ${MAX_WALLET_ADDRESSES} addresses`
                        : `Connect with ${row.title}`
                  }
                  style={{
                    ...connectButton,
                    opacity: awaitingSave || atCap ? 0.5 : 1,
                    cursor: awaitingSave || atCap ? 'not-allowed' : 'pointer',
                    transition: 'opacity .25s ease',
                  }}
                >
                  Connect
                </button>
              )
            }
          />
        );
      })}

      {storeError ? (
        <div role="alert" style={errorText}>
          {storeError}
        </div>
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
