'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppKit } from '@reown/appkit/react';
import { useConnections, useDisconnect } from 'wagmi';
import { LockedAction } from '@/components/ui/LockedAction';
import { tokens } from '@/components/ui/tokens';
import { type WalletConnection } from './connected-addresses';

/**
 * The reference's "+ Link another wallet" action.
 *
 * This is a **Holdings** action, not a link to onboarding. One click opens
 * AppKit; once a wallet is connected its address is persisted as a
 * `connected-wallet` watch-only row through the injected `onAddConnectedWallet`
 * (`addConnectedWallet`), and the connection is then torn down. The persisted
 * row survives a reload and appears **unsigned** in the list, where the resident
 * must use "Connect & sign" before it can move to the vault.
 *
 * Persisting does not verify: the row is written with `verified_at` NULL. The
 * 5-address cap is the server's rule, so a refusal is surfaced verbatim (a
 * `role="alert"` on the control) rather than duplicated here.
 *
 * The hooks are gated exactly as `WalletLinkPanel` gates them: when wallet
 * connection is not configured, only a locked control is rendered and no hook is
 * reached.
 */

export interface LinkAnotherWalletButtonProps {
  readonly configured: boolean;
  /** `addConnectedWallet`: persist an address as a connected-wallet row. */
  readonly onAddConnectedWallet: (address: string) => Promise<unknown>;
  /** Called after a successful persist so the list can refresh. */
  readonly onLinked: () => void;
}

export function LinkAnotherWalletButton(props: LinkAnotherWalletButtonProps) {
  if (!props.configured) return <LockedLinkAnother />;
  return <ConfiguredLinkAnother {...props} />;
}

function LockedLinkAnother() {
  return (
    <LockedAction
      height={36}
      reason="Wallet connection is not configured in this environment."
      style={{ fontSize: '13px', padding: '0 16px' }}
    >
      + Link another wallet
    </LockedAction>
  );
}

function ConfiguredLinkAnother({
  onAddConnectedWallet,
  onLinked,
}: Omit<LinkAnotherWalletButtonProps, 'configured'>) {
  const { open } = useAppKit();
  const connections = useConnections();
  const { disconnect } = useDisconnect();

  // Clicked and waiting for a wallet to connect; while true, the first live
  // connection is persisted.
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstConnection = connections[0] ?? null;
  const firstAddress = firstConnection?.accounts[0] ?? null;

  const persist = useCallback(
    async (connection: WalletConnection) => {
      const address = connection.accounts[0];
      if (!address) return;
      setBusy(true);
      setError(null);
      try {
        await onAddConnectedWallet(address);
        disconnect({ connector: connection.connector });
        setWaiting(false);
        onLinked();
      } catch (cause) {
        // The server owns the cap and its message; relay it unchanged.
        setError(
          cause instanceof Error
            ? cause.message
            : 'The wallet could not be linked. Nothing was saved.',
        );
        setWaiting(false);
      } finally {
        setBusy(false);
      }
    },
    [onAddConnectedWallet, disconnect, onLinked],
  );

  // Persist a wallet connected after the click.
  useEffect(() => {
    if (!waiting || !firstConnection || !firstAddress) return;
    void persist(firstConnection);
  }, [waiting, firstConnection, firstAddress, persist]);

  function handleClick() {
    if (busy) return;
    setError(null);
    if (firstConnection && firstAddress) {
      // A connection is already live: persist it rather than opening the modal.
      void persist(firstConnection);
      return;
    }
    setWaiting(true);
    void open({ view: 'Connect' });
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
      }}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        title="Connect a wallet and save its address, unsigned, to link it here."
        style={{
          height: '36px',
          padding: '0 16px',
          border: `1px solid ${tokens.border}`,
          borderRadius: '999px',
          background: '#fff',
          fontFamily: 'inherit',
          fontSize: '13px',
          fontWeight: 600,
          cursor: busy ? 'progress' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        + Link another wallet
      </button>
      {error ? (
        <span role="alert" style={{ fontSize: '12px', color: tokens.danger }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
