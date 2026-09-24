'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppKit } from '@reown/appkit/react';
import { useConnections, useDisconnect, useSignMessage } from 'wagmi';
import { Chip } from '@/components/ui/Chip';
import { tokens } from '@/components/ui/tokens';
import type { UnverifiedHoldingWallet } from '@/lib/wealth/holdings';
import { shortAddress } from '@/lib/wealth/format';
import { type WalletConnection } from './connected-addresses';
import type { OwnershipCallbacks } from '@/lib/wallet/ownership-callbacks';
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
 * Because linking and signing are one gesture, a wallet is never left persisted
 * and unsigned by this control: linking an unknown address verifies it in the
 * same pass. The override only relaxes the copy; the authority model is
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kade-control"
        style={openButton}
      >
        Link &amp; verify wallets
      </button>
      {open ? (
        <ModalShell onClose={() => setOpen(false)} configured={props.configured}>
          <ModalBody {...props} onClose={() => setOpen(false)} />
        </ModalShell>
      ) : null}
    </>
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

type Phase = 'idle' | 'connecting' | 'persisting' | 'signing' | 'done';

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
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<readonly string[]>([]);

  const connection: WalletConnection | null =
    connections.find((entry) => Boolean(entry.accounts[0])) ?? null;
  const address = connection?.accounts[0] ?? null;

  /**
   * Connect → persist → sign → disconnect, in one pass. The address that is
   * signed is always the connected one, whichever row it happens to match.
   */
  const run = useCallback(
    async (target: WalletConnection) => {
      const account = target.accounts[0];
      if (!account) return;
      setError(null);
      try {
        setPhase('persisting');
        // Persist first: an address not already listed becomes a row, so the
        // signature below always has a stored row to verify.
        await onAddConnectedWallet(account);

        setPhase('signing');
        const challenge = await onBegin(account);
        const signature = await signMessageAsync({
          account,
          message: challenge.message,
        });
        const result = await onComplete({
          address: account,
          message: challenge.message,
          signature,
        });
        if (!result.ok) {
          throw new Error(
            'The signature did not verify; the wallet was not verified.',
          );
        }

        setVerified((current) =>
          current.includes(account.toLowerCase())
            ? current
            : [...current, account.toLowerCase()],
        );
        setPhase('done');
        onLinked();
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'The wallet could not be verified. Nothing was changed.',
        );
        setPhase('idle');
      } finally {
        disconnect({ connector: target.connector });
      }
    },
    [
      onAddConnectedWallet,
      onBegin,
      onComplete,
      onLinked,
      signMessageAsync,
      disconnect,
    ],
  );

  // Once a wallet connects during the connecting phase, verify it immediately.
  useEffect(() => {
    if (phase !== 'connecting' || !connection || !address) return;
    void run(connection);
  }, [phase, connection, address, run]);

  const busy =
    phase === 'connecting' ||
    phase === 'persisting' ||
    phase === 'signing';

  function handleVerify() {
    if (busy) return;
    setError(null);
    if (connection && address) {
      // A connection is already live: verify it rather than opening AppKit.
      void run(connection);
      return;
    }
    setPhase('connecting');
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
          {remaining.map((wallet) => (
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
          ))}
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
