'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppKit, useAppKitState } from '@reown/appkit/react';
import { useConnections, useDisconnect, useSignMessage } from 'wagmi';
import { readAddressBalances } from '@/app/onboarding/wallet-actions';
import { Card } from '@/components/ui/Card';
import { tokens } from '@/components/ui/tokens';
import { WalletConnectGlyph } from '@/components/icons/WalletConnectGlyph';
import { WalletGlyph } from '@/components/icons/WalletGlyph';
import { shortAddress } from '@/lib/wealth/format';
import type { OwnershipCallbacks } from '@/lib/wallet/ownership-callbacks';
import {
  useConnectPersistSign,
  type SignMessageAsync,
} from '@/components/wallet/useConnectPersistSign';
import {
  MAX_WALLET_ADDRESSES,
  type EvmChainBalance,
} from '@/lib/wealth/types';
import { readFailureNotes } from '@/components/wallet/read-failure';

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
 * When the step also supplies the ownership callbacks, the saved address can be
 * **signed** through the shared `useConnectPersistSign`, so the row appears
 * verified in Holdings without a second trip to its modal. Signing is the
 * second of two steps and is deliberately **user-triggered**: the attempt
 * persists the address, then pauses and the row offers "Sign to verify" next to
 * "Skip for now". Nothing is signed until the resident asks for it. The store
 * always happens first, so a skip or a failure leaves exactly the persisted,
 * unverified row above. Only a real connection signs — a pasted Bitcoin or EVM
 * address never reaches this panel and never produces a signature.
 *
 * This is an **inline** experience. AppKit already opens its own modal to pick a
 * wallet, so the panel never renders a second, Kade-authored overlay: the step
 * indicator, the busy affordance and the sign/skip controls all live inside the
 * connection row. While an attempt is in flight (connecting, reading, saving,
 * waiting for the signature or signing) the other Connect controls are
 * disabled, so a second flow cannot start underneath the first.
 *
 * The connection is used only to **read** and, once saved, to sign the
 * server-issued challenge. It confers no authority over the resident Safe: the
 * address comes from the browser, and only the server's verification of the
 * signature sets `verified_at`.
 *
 * Every AppKit and wagmi hook lives in `ConfiguredWalletPanel` (and, only when
 * the ownership callbacks are supplied, its `SigningConfiguredWalletPanel`
 * wrapper). Both are mounted only when a WalletConnect project id is configured
 * and `WalletProvider` has therefore mounted a `WagmiProvider`. Calling those
 * hooks without a provider throws, and the route has no error boundary, so the
 * unconfigured environment renders `UnconfiguredWalletPanel` instead: pure
 * static markup with no hooks, an honest "not configured" notice, and no way to
 * reach a modal that does not exist.
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
  /**
   * The ownership-proof callbacks, injected by the page. When supplied, a
   * connected address is saved and then offered a signature: signing marks it
   * verified in Holdings. The signature is always skippable and a skip or
   * failure leaves the saved row untouched and unverified. Omitted in
   * read-only/Step-3-without-proof use.
   */
  readonly ownership?: ConnectedWalletOwnership;
  /** True when the shared EVM-address cap is already reached. */
  readonly atCap?: boolean;
}

/**
 * The ownership callbacks this panel needs, a subset of `OwnershipCallbacks`.
 * `onLinked` is optional here: onboarding has nothing to refresh after a
 * verification, while Holdings re-reads its aggregate.
 */
export interface ConnectedWalletOwnership {
  readonly onBegin: OwnershipCallbacks['onBegin'];
  readonly onComplete: OwnershipCallbacks['onComplete'];
  readonly onLinked?: OwnershipCallbacks['onLinked'];
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
 * What one row of the panel is doing, derived from the shared attempt's phase
 * and the wallets latched into that row. This is what drives the inline step
 * label and the action on the right, without any Kade-authored overlay.
 */
type RowStatus =
  | 'connectable'
  | 'connecting'
  | 'reading'
  | 'persisting'
  | 'awaiting-sign'
  | 'signing'
  | 'connected';

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
  ownership,
  atCap = false,
}: ConnectedWalletPanelProps) {
  // Gate the hooks on configuration, exactly as FeeStep gates FeePayment on
  // `paymentConfigured`: a component that calls the wallet hooks is never
  // mounted unless WagmiProvider/createAppKit are actually present.
  if (!configured) return <UnconfiguredWalletPanel />;
  // Signing needs `useSignMessage`; it is called only when the page actually
  // supplied the proof callbacks, so a panel that never signs never mounts the
  // signer. This is a component boundary, not a conditional hook.
  if (ownership) {
    return (
      <SigningConfiguredWalletPanel
        onChange={onChange}
        onSaveConnectedWallet={onSaveConnectedWallet}
        ownership={ownership}
        atCap={atCap}
      />
    );
  }
  return (
    <ConfiguredWalletPanel
      onChange={onChange}
      onSaveConnectedWallet={onSaveConnectedWallet}
      atCap={atCap}
    />
  );
}

/** The configured panel with the ownership signer supplied. */
function SigningConfiguredWalletPanel({
  onChange,
  onSaveConnectedWallet,
  ownership,
  atCap,
}: Readonly<{
  onChange: (states: readonly ConnectedWalletState[] | null) => void;
  onSaveConnectedWallet?: (address: string) => Promise<void> | void;
  ownership: ConnectedWalletOwnership;
  atCap: boolean;
}>) {
  const { signMessageAsync } = useSignMessage();
  return (
    <ConfiguredWalletPanel
      onChange={onChange}
      onSaveConnectedWallet={onSaveConnectedWallet}
      ownership={ownership}
      signMessageAsync={signMessageAsync}
      atCap={atCap}
    />
  );
}

/**
 * A single wallet row. Presentational only: it holds no wallet state and calls
 * no hooks, so it can be rendered on both the configured and unconfigured path.
 * A `note` names the specific reason a live wallet's balance read is incomplete,
 * so a failed USDC sub-read is never a silent gap.
 */
function WalletRow({
  row,
  subtitle,
  action,
  note,
}: Readonly<{
  row: (typeof ROWS)[number];
  subtitle: string;
  action: ReactNode;
  note?: ReactNode;
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
      {note ? <div style={walletNote}>{note}</div> : null}
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
  ownership,
  signMessageAsync,
  atCap,
}: Readonly<{
  onChange: (states: readonly ConnectedWalletState[] | null) => void;
  onSaveConnectedWallet?: (address: string) => Promise<void> | void;
  ownership?: ConnectedWalletOwnership;
  signMessageAsync?: SignMessageAsync;
  atCap: boolean;
}>) {
  const { open } = useAppKit();
  const { open: appKitOpen } = useAppKitState();
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

  // The shared connect → persist → sign → disconnect attempt. It persists
  // through the same save handler and signs only when the page supplied the
  // ownership callbacks. A store failure keeps the connection live for retry
  // (`disconnectOnPersistFailure: false`), which is this panel's contract.
  // `awaitSignatureConfirmation` holds the attempt after persisting until the
  // resident presses "Sign to verify" or "Skip for now", so the signature is
  // never auto-fired the instant a wallet connects.
  const {
    phase: signPhase,
    activeAddress,
    run: runAttempt,
    skip: skipSignature,
    confirmSignature,
    beginConnecting,
    reset: resetAttempt,
  } = useConnectPersistSign({
    persist: async (address) => {
      await addWalletAddressRef.current?.(address);
    },
    signMessageAsync,
    onBegin: ownership?.onBegin,
    onComplete: ownership?.onComplete,
    onLinked: ownership?.onLinked,
    disconnectOnPersistFailure: false,
    awaitSignatureConfirmation: true,
  });

  // Which row opened AppKit, while the resident is still choosing a wallet.
  // Cleared as soon as the attempt leaves `connecting` (connected, or let go).
  const [pendingRow, setPendingRow] = useState<
    (typeof ROWS)[number]['key'] | null
  >(null);

  // AppKit is the only modal in this flow. Track whether it actually opened, so
  // a resident who dismisses it without connecting returns the row to an
  // actionable state instead of leaving the panel stuck on "connecting". The
  // guard is needed because `open()` flips AppKit's own state a tick after the
  // click, so the first `open: false` render must not be read as a dismissal.
  const appKitWasOpen = useRef(false);
  useEffect(() => {
    if (appKitOpen) {
      appKitWasOpen.current = true;
      return;
    }
    if (!appKitWasOpen.current) return;
    appKitWasOpen.current = false;
    if (signPhase === 'connecting') {
      resetAttempt();
      setPendingRow(null);
    }
  }, [appKitOpen, signPhase, resetAttempt]);

  // Once the attempt moves past `connecting` (a wallet connected, or it settled)
  // the row no longer needs to be marked as the one AppKit was opened for.
  useEffect(() => {
    if (signPhase !== 'connecting') setPendingRow(null);
  }, [signPhase]);

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
  // watch-only row, signed when ownership callbacks are present, and then torn
  // down. The attempt runs once per read; a save failure keeps the live row
  // (and shows the server's message) instead of silently losing the wallet. A
  // skip or a signature failure still leaves the saved row, unverified.
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
          const outcome = await runAttempt({
            address: wallet.address,
            connector: wallet.connector,
          });
          if (!mounted.current) return;
          if (!outcome.persisted) {
            // The store failed; the attempt already left the connection live.
            setStoreError(
              outcome.error ??
                'The address could not be saved as a watch-only row.',
            );
            return;
          }
          // Persisted, whether or not the signature verified. Drop the live
          // entry and report the settled list in the same step, so the parent's
          // summary cannot observe a transient "still connected" state while
          // the report effect waits for the next render.
          storedKeys.current.add(
            `${wallet.uid}:${wallet.address.toLowerCase()}`,
          );
          setStoreError(null);
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
  }, [wallets, report, runAttempt]);

  // Report the deduplicated list upward. An empty list is reported as null, the
  // "nothing is connected" shape the step already understood.
  useEffect(() => {
    report(wallets);
  }, [wallets, report]);

  function connect(key: (typeof ROWS)[number]['key']) {
    // A fresh attempt starts without the previous store's error on screen.
    setStoreError(null);
    // Step 1 starts the moment the row is clicked, so the other Connect control
    // is disabled while AppKit is open and the resident is choosing a wallet.
    setPendingRow(key);
    beginConnecting();
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

  // The sign step is offered only when the page supplied the signer, which it
  // does exactly when it supplied the ownership callbacks.
  const signingAvailable = signMessageAsync !== undefined;
  const signStepActive =
    signPhase === 'awaiting-sign' || signPhase === 'signing';
  const attemptInFlight =
    signPhase === 'connecting' ||
    signPhase === 'persisting' ||
    signPhase === 'awaiting-sign' ||
    signPhase === 'signing';
  const anyReading = wallets.some((entry) => entry.reading);
  // While any part of an attempt is in flight, no other row may start a second
  // connect: the resident either finishes this one or skips the signature.
  const controlsLocked = attemptInFlight || anyReading;

  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      {signingAvailable ? <StepProgress active={signStepActive} /> : null}

      {ROWS.map((row) => {
        const rowWalletConnect = row.key === 'walletconnect';
        const rowWallets = wallets.filter(
          (entry) => entry.usesWalletConnect === rowWalletConnect,
        );
        const connectedHere = rowWallets.length > 0;
        const addresses = rowWallets
          .map((entry) => shortAddress(entry.address))
          .join(', ');
        // The specific reasons any wallet in this row could not be fully read.
        // They ride on the same `tokenFailure`/`readError` carrier the other
        // surfaces use, so a failed USDC sub-read or a whole-chain failure is
        // named for the wallet the resident is looking at rather than dropped.
        const failureNotes = rowWallets.flatMap((entry) =>
          readFailureNotes(entry).map((message) => ({
            address: entry.address,
            message,
          })),
        );
        const matchesActive =
          activeAddress !== null &&
          rowWallets.some(
            (entry) =>
              entry.address.toLowerCase() === activeAddress.toLowerCase(),
          );
        // With a save handler the panel reads the balance, saves the address and
        // then tears the connection down itself; a failed save keeps the
        // connection live, so Disconnect returns for recovery.
        const awaitingSave =
          connectedHere && onSaveConnectedWallet !== undefined && !storeError;

        let status: RowStatus;
        if (signPhase === 'connecting' && pendingRow === row.key) {
          status = 'connecting';
        } else if (matchesActive && signPhase === 'awaiting-sign') {
          status = 'awaiting-sign';
        } else if (matchesActive && signPhase === 'signing') {
          status = 'signing';
        } else if (awaitingSave) {
          status = signPhase === 'persisting' ? 'persisting' : 'reading';
        } else if (connectedHere) {
          status = 'connected';
        } else {
          status = 'connectable';
        }

        let subtitle: string;
        if (status === 'connecting') {
          subtitle = signingAvailable
            ? 'Step 1 of 2 · waiting for your wallet…'
            : 'Waiting for your wallet…';
        } else if (status === 'awaiting-sign' || status === 'signing') {
          subtitle = `${addresses} · step 2 of 2`;
        } else if (
          signingAvailable &&
          (status === 'reading' || status === 'persisting')
        ) {
          subtitle = `${addresses} · step 1 of 2`;
        } else {
          subtitle = connectedHere ? addresses : row.subtitle;
        }

        let action: ReactNode;
        switch (status) {
          case 'connecting':
            action = <BusyAction label="Waiting for your wallet…" />;
            break;
          case 'reading':
            action = <BusyAction label="Reading balance…" />;
            break;
          case 'persisting':
            action = <BusyAction label="Saving address…" />;
            break;
          case 'awaiting-sign':
            action = (
              <div style={actionGroup}>
                <button
                  type="button"
                  onClick={confirmSignature}
                  title="Sign the challenge to verify this wallet for Holdings."
                  style={primaryAction}
                >
                  Sign to verify
                </button>
                <button
                  type="button"
                  onClick={skipSignature}
                  title="Keep the address saved and skip verifying it for now."
                  style={secondaryAction}
                >
                  Skip for now
                </button>
              </div>
            );
            break;
          case 'signing':
            action = (
              <div style={actionGroup}>
                <BusyAction label="Signing…" />
                <button
                  type="button"
                  onClick={skipSignature}
                  title="Keep the address saved and skip verifying it for now."
                  style={secondaryAction}
                >
                  Skip for now
                </button>
              </div>
            );
            break;
          case 'connected':
            action = (
              <button
                type="button"
                onClick={() => disconnectMethod(rowWalletConnect)}
                style={connectButton}
              >
                Disconnect
              </button>
            );
            break;
          default:
            action = (
              <button
                type="button"
                onClick={() => connect(row.key)}
                disabled={controlsLocked || atCap}
                title={
                  atCap
                    ? `Up to ${MAX_WALLET_ADDRESSES} addresses`
                    : controlsLocked
                      ? 'Finish the wallet already in progress.'
                      : `Connect with ${row.title}`
                }
                style={{
                  ...connectButton,
                  opacity: controlsLocked || atCap ? 0.5 : 1,
                  cursor: controlsLocked || atCap ? 'not-allowed' : 'pointer',
                  transition: 'opacity .25s ease',
                }}
              >
                Connect
              </button>
            );
        }

        return (
          <WalletRow
            key={row.key}
            row={row}
            subtitle={subtitle}
            action={action}
            note={
              failureNotes.length > 0 ? (
                <div role="alert">
                  {failureNotes.map((failure) => (
                    <div key={`${failure.address}:${failure.message}`}>
                      {shortAddress(failure.address)} — {failure.message}
                    </div>
                  ))}
                </div>
              ) : null
            }
          />
        );
      })}

      {signingAvailable ? (
        <p style={mutedNote}>
          Step 2 is optional. Your wallet will ask you to sign a challenge,
          which verifies the address for Holdings. It is not a login and gives
          Kade no authority over your Safe — nothing moves and no spending is
          approved. You can skip it now and verify the address later.
        </p>
      ) : null}

      {storeError ? (
        <div role="alert" style={errorText}>
          {storeError}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The two-step progress strip. It lives inline above the connection rows, never
 * as an overlay, so AppKit's own modal remains the only modal in the flow.
 */
function StepProgress({ active }: Readonly<{ active: boolean }>) {
  return (
    <div style={stepBar}>
      <StepChip
        index={1}
        label="Step 1 · Connect"
        state={active ? 'done' : 'active'}
      />
      <span aria-hidden style={stepConnector} />
      <StepChip
        index={2}
        label="Step 2 · Sign (optional)"
        state={active ? 'active' : 'upcoming'}
      />
    </div>
  );
}

function StepChip({
  index,
  label,
  state,
}: Readonly<{
  index: number;
  label: string;
  state: 'active' | 'done' | 'upcoming';
}>) {
  return (
    <span
      style={{
        ...stepChip,
        ...(state === 'active' ? stepChipActive : null),
        ...(state === 'done' ? stepChipDone : null),
      }}
      aria-current={state === 'active' ? 'step' : undefined}
    >
      <span
        aria-hidden
        style={{
          ...stepDot,
          ...(state === 'active' ? stepDotActive : null),
          ...(state === 'done' ? stepDotDone : null),
        }}
      >
        {state === 'done' ? '✓' : index}
      </span>
      {label}
    </span>
  );
}

/** An inline progress affordance for a row whose attempt is in flight. */
function BusyAction({ label }: Readonly<{ label: string }>) {
  return (
    <div role="status" aria-live="polite" style={busyAction}>
      <span
        role="progressbar"
        aria-label={label}
        className="kade-spinner"
        style={spinner}
      />
      <span>{label}</span>
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

/** A live wallet's specific balance-read failure, named under its row. */
const walletNote: React.CSSProperties = {
  marginTop: '8px',
  borderTop: `1px solid ${tokens.border}`,
  paddingTop: '8px',
  fontSize: '11.5px',
  color: tokens.danger,
  lineHeight: 1.5,
};

const stepBar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '0 2px 2px',
};

const stepChip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11.5px',
  fontWeight: 600,
  color: tokens.muted,
  whiteSpace: 'nowrap',
};

const stepChipActive: React.CSSProperties = {
  color: tokens.ink,
};

const stepChipDone: React.CSSProperties = {
  color: tokens.success,
};

const stepDot: React.CSSProperties = {
  width: '16px',
  height: '16px',
  borderRadius: '999px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: tokens.border,
  background: '#fff',
  color: tokens.muted,
  fontSize: '9.5px',
  fontWeight: 700,
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 auto',
};

const stepDotActive: React.CSSProperties = {
  borderColor: tokens.action,
  background: tokens.action,
  color: '#fff',
};

const stepDotDone: React.CSSProperties = {
  borderColor: tokens.success,
  background: tokens.success,
  color: '#fff',
};

const stepConnector: React.CSSProperties = {
  flex: '0 0 14px',
  height: '1px',
  background: tokens.border,
};

const actionGroup: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flex: '0 0 auto',
};

const busyAction: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '12.5px',
  fontWeight: 600,
  color: tokens.muted,
  whiteSpace: 'nowrap',
  flex: '0 0 auto',
};

const spinner: React.CSSProperties = {
  width: '15px',
  height: '15px',
  flexShrink: 0,
  border: '2px solid rgba(16,24,40,.16)',
  borderTopColor: tokens.action,
  borderRadius: '999px',
};

const primaryAction: React.CSSProperties = {
  height: '36px',
  padding: '0 16px',
  border: 0,
  borderRadius: '999px',
  background: tokens.action,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  flex: '0 0 auto',
};

const secondaryAction: React.CSSProperties = {
  height: '36px',
  padding: '0 14px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  color: tokens.ink,
  fontFamily: 'inherit',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  flex: '0 0 auto',
};
