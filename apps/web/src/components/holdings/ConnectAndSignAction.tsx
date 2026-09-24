'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppKit } from '@reown/appkit/react';
import { useConnections, useDisconnect, useSignMessage } from 'wagmi';
import { Chip } from '@/components/ui/Chip';
import { LockedAction } from '@/components/ui/LockedAction';
import { tokens } from '@/components/ui/tokens';
import { shortAddress } from '@/lib/wealth/format';
import type { UnverifiedHoldingWallet } from '@/lib/wealth/holdings';
import {
  connectionForAddress,
  liveAddresses,
  type WalletAddress,
} from './connected-addresses';
import type { OwnershipCallbacks } from './ownership-callbacks';

/**
 * The per-row "Connect & sign" action for an unverified Holdings row.
 *
 * A connected wallet or a pasted EVM address becomes verified only by signing
 * the server-issued challenge with the wallet that controls it (v1.3). One click
 * opens AppKit when the controlling wallet is not connected yet, signs with it
 * once it is, and then **tears the connection down** — the same connect → prove
 * → disconnect shape the onboarding wallet panel uses, so the resident is not
 * left with a live connection after proving an address.
 *
 * It performs only the browser half and reuses the injected `onBegin` /
 * `onComplete` callbacks (front 03's ownership interface); it re-implements no
 * challenge, verification or write. The address must match the row
 * case-insensitively, and a mismatch is reported on the row rather than asking
 * the wrong wallet to sign.
 *
 * The hooks are gated on configuration: when wallet connection is not
 * configured, only a locked control is rendered and no hook is reached, so the
 * unconfigured path cannot throw.
 */

export interface ConnectAndSignActionProps {
  readonly wallet: UnverifiedHoldingWallet;
  readonly configured: boolean;
  readonly onBegin: OwnershipCallbacks['onBegin'];
  readonly onComplete: OwnershipCallbacks['onComplete'];
  /** Called after a successful verification so the page can refresh. */
  readonly onLinked: OwnershipCallbacks['onLinked'];
}

/** The honest guidance for an unverified row with no controlling connection. */
function guidance(
  wallet: UnverifiedHoldingWallet,
  connected: readonly string[],
): string {
  const target = shortAddress(wallet.address);
  if (connected.length === 0) {
    return `Connect the wallet that controls ${target} to sign it.`;
  }
  return `Connect the wallet that controls ${target} — the connected wallet ${connected
    .map(shortAddress)
    .join(', ')} does not control it.`;
}

export function ConnectAndSignAction(props: ConnectAndSignActionProps) {
  if (!props.configured) return <LockedConnectAndSign />;
  return <ConfiguredConnectAndSign {...props} />;
}

function LockedConnectAndSign() {
  return (
    <LockedAction
      height={32}
      reason="Wallet connection is not configured in this environment."
      style={{ fontSize: '12.5px', padding: '0 14px' }}
    >
      Connect &amp; sign
    </LockedAction>
  );
}

type Phase = 'idle' | 'connecting' | 'signing' | 'done';

function ConfiguredConnectAndSign({
  wallet,
  onBegin,
  onComplete,
  onLinked,
}: Omit<ConnectAndSignActionProps, 'configured'>) {
  const { open } = useAppKit();
  const connections = useConnections();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const connected = liveAddresses(connections);
  const connection = connectionForAddress(connections, wallet.address);
  const controlling =
    connection?.accounts.find(
      (account) =>
        account.trim().toLowerCase() === wallet.address.trim().toLowerCase(),
    ) ?? null;

  const sign = useCallback(
    async (account: WalletAddress) => {
      setPhase('signing');
      setError(null);
      const signedConnection = connection;
      try {
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
            'The signature did not verify; the wallet was not signed.',
          );
        }
        setPhase('done');
        onLinked();
      } catch (cause) {
        setPhase('idle');
        setError(
          cause instanceof Error
            ? cause.message
            : 'The wallet could not be signed. Nothing was saved.',
        );
      } finally {
        // Prove, then leave no connection behind — mirroring onboarding.
        if (signedConnection) {
          disconnect({ connector: signedConnection.connector });
        }
      }
    },
    [connection, onBegin, onComplete, onLinked, signMessageAsync, disconnect],
  );

  // Once the controlling wallet is connected during the "connecting" phase, sign
  // with it. This is what turns one click (connect) into connect-and-sign.
  useEffect(() => {
    if (phase !== 'connecting' || !controlling) return;
    void sign(controlling);
  }, [phase, controlling, sign]);

  function handleClick() {
    if (phase === 'signing' || phase === 'done') return;
    setError(null);
    if (!controlling) {
      setError(guidance(wallet, connected));
      void open({ view: 'Connect' });
    }
    setPhase('connecting');
  }

  if (phase === 'done') {
    return (
      <Chip tone="success" dot>
        Signed · refreshing
      </Chip>
    );
  }

  const busy = phase === 'signing';
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
        title={`Connect the wallet that controls ${wallet.address} and sign to prove it.`}
        style={{
          height: '32px',
          padding: '0 14px',
          border: `1px solid ${tokens.border}`,
          borderRadius: '999px',
          background: '#fff',
          fontFamily: 'inherit',
          fontSize: '12.5px',
          fontWeight: 600,
          cursor: busy ? 'progress' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy
          ? 'Signing…'
          : phase === 'connecting'
            ? 'Connecting…'
            : 'Connect & sign'}
      </button>
      {error ? (
        <span role="alert" style={{ fontSize: '12px', color: tokens.danger }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
