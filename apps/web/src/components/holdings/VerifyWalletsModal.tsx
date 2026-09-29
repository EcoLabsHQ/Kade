'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppKit } from '@reown/appkit/react';
import { useConnections, useSignMessage } from 'wagmi';
import { Chip } from '@/components/ui/Chip';
import { tokens } from '@/components/ui/tokens';
import type { UnverifiedHoldingWallet } from '@/lib/wealth/holdings';
import type { EvmReadFailure } from '@/lib/wealth/types';
import { shortAddress } from '@/lib/wealth/format';
import { type WalletConnection } from './connected-addresses';
import type { OwnershipCallbacks } from '@/lib/wallet/ownership-callbacks';
import { useConnectPersistSign } from '@/components/wallet/useConnectPersistSign';
import { useDisconnectThenAct } from '@/components/wallet/useDisconnectThenAct';
import { provenanceLabel } from './provenance';

/**
 * The "Verify wallets" modal.
 *
 * One control opens it; inside, every unverified wallet the resident holds is
 * listed with its provenance, and a single action **connects, persists and
 * signs**:
 *
 *   1. AppKit connects a wallet;
 *   2. its address is persisted through `onAddConnectedWallet` — so an address
 *      that was not in the list becomes a `connected-wallet` row;
 *   3. the server-issued challenge is signed through `onBegin`/`onComplete`
 *      (front 03's ownership interface — this component re-implements none of
 *      it), which sets `verified_at` on the server;
 *   4. the connection is torn down, so the modal returns to its initial state.
 *
 * Because linking and signing are one gesture, this control does not leave a
 * wallet persisted-and-unsigned by *choice*: there is no skip here, and an
 * unknown address is persisted and signed in the same pass. A **failed
 * signature is different** — the address has already been persisted by then, so
 * on a failure the row is left persisted and unverified, exactly as the
 * onboarding path leaves it when the resident skips. The authority model is
 * unchanged — a connection alone never sets `verified_at`, and the signature is
 * not a login and confers no Safe authority.
 *
 * Hooks are gated on `configured` in the outer component, so the unconfigured
 * path renders static markup and reaches no AppKit/wagmi hook.
 */

export interface VerifyWalletsModalProps {
  readonly configured: boolean;
  /** The unverified wallets currently listed on the screen. */
  readonly wallets: readonly UnverifiedHoldingWallet[];
  /** `addConnectedWallet`: persist an address as a connected-wallet row. */
  readonly onAddConnectedWallet: (address: string) => Promise<unknown>;
  readonly onBegin: OwnershipCallbacks['onBegin'];
  readonly onComplete: OwnershipCallbacks['onComplete'];
  /** Called after a verification so the page can refresh the aggregate. */
  readonly onLinked: OwnershipCallbacks['onLinked'];
}

export function VerifyWalletsModal(props: VerifyWalletsModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {props.configured ? (
        <ConfiguredTrigger onOpen={() => setOpen(true)} />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="kade-control"
          style={openButton}
        >
          Link &amp; verify wallets
        </button>
      )}
      {open ? (
        <ModalShell onClose={() => setOpen(false)} configured={props.configured}>
          <ModalBody {...props} onClose={() => setOpen(false)} />
        </ModalShell>
      ) : null}
    </>
  );
}

/**
 * The "Link & verify wallets" trigger on the configured path.
 *
 * It disconnects the connected wallet **before** it opens the modal, so the
 * modal always starts in its "Not connected" state and the resident reconnects
 * deliberately: a carried-over session is never used. The click is a sequence,
 * not a race — `useDisconnectThenAct` awaits the teardown, then opens — and a
 * failed disconnect still opens the modal rather than dead-ending the resident.
 *
 * It calls wagmi hooks, so it is mounted only when `WalletProvider` mounted a
 * `WagmiProvider`; the unconfigured path renders a plain button instead.
 */
function ConfiguredTrigger({ onOpen }: Readonly<{ onOpen: () => void }>) {
  const { run: disconnectThenAct } = useDisconnectThenAct();

  return (
    <button
      type="button"
      onClick={() => void disconnectThenAct(onOpen)}
      className="kade-control"
      style={openButton}
    >
      Link &amp; verify wallets
    </button>
  );
}

/** The overlay + panel. No hooks; closable by backdrop, the ✕, or Escape. */
function ModalShell({
  children,
  onClose,
  configured,
}: Readonly<{
  children: React.ReactNode;
  onClose: () => void;
  configured: boolean;
}>) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={backdrop}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Verify wallets"
        onClick={(event) => event.stopPropagation()}
        style={panel}
      >
        <div style={panelHeader}>
          <div>
            <h2 style={panelTitle}>Verify wallets</h2>
            <p style={panelSubtitle}>
              {configured
                ? 'Connect a wallet and sign the challenge to prove you control it. Signing verifies the wallet for your holdings.'
                : 'Wallet connection is not configured in this environment.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={closeButton}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalBody({
  configured,
  wallets,
  onAddConnectedWallet,
  onBegin,
  onComplete,
  onLinked,
  onClose,
}: VerifyWalletsModalProps & { readonly onClose: () => void }) {
  if (!configured) return <LockedBody />;
  return (
    <ConfiguredBody
      wallets={wallets}
      onAddConnectedWallet={onAddConnectedWallet}
      onBegin={onBegin}
      onComplete={onComplete}
      onLinked={onLinked}
      onClose={onClose}
    />
  );
}

function LockedBody() {
  return (
    <p style={emptyNote}>
      Wallet connection is not configured here, so a wallet cannot be verified.
    </p>
  );
}

/**
 * The specific reasons this wallet's USDC sub-read failed, one per chain, so the
 * row can name *why* the token amount is unread instead of leaving the
 * native-only total as if nothing were missing. A successful read, and a chain
 * that was never read for USDC, contribute nothing; no zero is fabricated.
 */
function tokenFailuresOf(
  wallet: UnverifiedHoldingWallet,
): readonly EvmReadFailure[] {
  return wallet.chains.flatMap((chain) =>
    chain.tokenFailure ? [chain.tokenFailure] : [],
  );
}

function ConfiguredBody({
  wallets,
  onAddConnectedWallet,
  onBegin,
  onComplete,
  onLinked,
  onClose,
}: Omit<VerifyWalletsModalProps, 'configured'> & {
  readonly onClose: () => void;
}) {
  const { open } = useAppKit();
  const connections = useConnections();
  const { signMessageAsync } = useSignMessage();

  const [verified, setVerified] = useState<readonly string[]>([]);

  const connection: WalletConnection | null =
    connections.find((entry) => Boolean(entry.accounts[0])) ?? null;
  const address = connection?.accounts[0] ?? null;

  // Connect → persist → sign → disconnect, in one pass, through the shared
  // attempt. The address that is signed is always the connected one, whichever
  // row it happens to match.
  const { phase, error, busy, run: attempt, beginConnecting } =
    useConnectPersistSign({
      persist: onAddConnectedWallet,
      signMessageAsync,
      onBegin,
      onComplete,
      onLinked,
    });

  const run = useCallback(
    async (target: WalletConnection) => {
      const account = target.accounts[0];
      if (!account) return;
      const result = await attempt({
        address: account,
        connector: target.connector,
      });
      if (!result.verified) return;
      setVerified((current) =>
        current.includes(account.toLowerCase())
          ? current
          : [...current, account.toLowerCase()],
      );
    },
    [attempt],
  );

  // Once a wallet connects during the connecting phase, verify it immediately.
  useEffect(() => {
    if (phase !== 'connecting' || !connection || !address) return;
    void run(connection);
  }, [phase, connection, address, run]);

  function handleVerify() {
    if (busy) return;
    if (connection && address) {
      // A connection is already live: verify it rather than opening AppKit.
      void run(connection);
      return;
    }
    beginConnecting();
    void open({ view: 'Connect' });
  }

  const verifiedSet = new Set(verified);
  const remaining = wallets.filter(
    (wallet) => !verifiedSet.has(wallet.address.toLowerCase()),
  );

  return (
    <div>
      {remaining.length > 0 ? (
        <ul style={list}>
          {remaining.map((wallet) => {
            const tokenFailures = tokenFailuresOf(wallet);
            return (
              <li key={wallet.address} style={row}>
                <div style={{ minWidth: 0 }}>
                  <div title={wallet.address} style={rowAddress}>
                    {shortAddress(wallet.address)}
                  </div>
                  <div style={rowMeta}>
                    <Chip tone="warning" dot>
                      Unverified
                    </Chip>
                    <span style={rowProvenance}>
                      {provenanceLabel(wallet.provider)} · chains{' '}
                      {wallet.chainIds.join(', ')}
                    </span>
                  </div>
                  {tokenFailures.length > 0 ? (
                    <div style={rowTokenNote}>
                      {tokenFailures
                        .map((failure) => `USDC — ${failure.message}`)
                        .join(' ')}
                    </div>
                  ) : null}
                </div>
                <span style={rowValue}>
                  {wallet.readError || wallet.usd === null
                    ? '—'
                    : new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        maximumFractionDigits: 0,
                      }).format(wallet.usd)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p style={emptyNote}>
          {verified.length > 0
            ? 'Every wallet here is verified.'
            : 'No unverified wallets. Link one to prove control of it.'}
        </p>
      )}

      {error ? (
        <div role="alert" style={errorText}>
          {error}
        </div>
      ) : null}

      <div style={modalActions}>
        <button
          type="button"
          onClick={handleVerify}
          disabled={busy}
          title={
            busy
              ? 'Connecting, saving and signing the wallet.'
              : 'Connect a wallet and sign the challenge to verify it.'
          }
          style={{
            ...primaryButton,
            opacity: busy ? 0.6 : 1,
            cursor: busy ? 'progress' : 'pointer',
          }}
        >
          {phase === 'persisting'
            ? 'Saving…'
            : phase === 'signing'
              ? 'Signing…'
              : phase === 'connecting'
                ? 'Waiting for wallet…'
                : 'Link & sign a wallet'}
        </button>
        <button type="button" onClick={onClose} style={secondaryButton}>
          {remaining.length > 0 ? 'Close' : 'Done'}
        </button>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(16, 24, 40, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  zIndex: 50,
};

const panel: React.CSSProperties = {
  background: '#fff',
  borderRadius: '14px',
  border: `1px solid ${tokens.border}`,
  width: '100%',
  maxWidth: '560px',
  maxHeight: '80vh',
  overflowY: 'auto',
  padding: '22px 24px',
  boxShadow: '0 18px 40px rgba(16, 24, 40, 0.18)',
};

const panelHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '16px',
};

const panelTitle: React.CSSProperties = {
  margin: 0,
  fontSize: '17px',
  fontWeight: 600,
};

const panelSubtitle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: '12.5px',
  color: tokens.muted,
  maxWidth: '48ch',
};

const closeButton: React.CSSProperties = {
  border: 0,
  background: 'transparent',
  fontFamily: 'inherit',
  fontSize: '15px',
  lineHeight: 1,
  cursor: 'pointer',
  color: tokens.muted,
  padding: '4px',
  flex: '0 0 auto',
};

const list: React.CSSProperties = {
  listStyle: 'none',
  margin: '16px 0 0',
  padding: 0,
};

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '12px 0',
  borderBottom: `1px solid ${tokens.border}`,
};

const rowAddress: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '13px',
  fontWeight: 600,
};

const rowMeta: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginTop: '6px',
  flexWrap: 'wrap',
};

const rowProvenance: React.CSSProperties = {
  fontSize: '11.5px',
  color: tokens.muted,
};

/** The specific reason a row's USDC sub-read is unread, never a silent gap. */
const rowTokenNote: React.CSSProperties = {
  marginTop: '4px',
  fontSize: '11.5px',
  color: tokens.danger,
  lineHeight: 1.5,
};

const rowValue: React.CSSProperties = {
  fontSize: '13.5px',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

const modalActions: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: '10px',
  marginTop: '18px',
  flexWrap: 'wrap',
};

const openButton: React.CSSProperties = {
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

const primaryButton: React.CSSProperties = {
  height: '36px',
  padding: '0 16px',
  border: 0,
  borderRadius: '999px',
  background: tokens.ink,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '13px',
  fontWeight: 600,
};

const secondaryButton: React.CSSProperties = {
  height: '36px',
  padding: '0 16px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '999px',
  background: '#fff',
  color: tokens.ink,
  fontFamily: 'inherit',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const emptyNote: React.CSSProperties = {
  margin: '16px 0 0',
  fontSize: '13px',
  color: tokens.muted,
  lineHeight: 1.6,
};

const errorText: React.CSSProperties = {
  marginTop: '12px',
  fontSize: '12.5px',
  color: tokens.danger,
};
