'use client';

import { useState } from 'react';
import { useConnections, useSignMessage } from 'wagmi';
import { Chip } from '@/components/ui/Chip';
import { LockedAction } from '@/components/ui/LockedAction';
import { tokens } from '@/components/ui/tokens';
import { shortAddress } from '@/lib/wealth/format';
import type { UnverifiedHoldingWallet } from '@/lib/wealth/holdings';
import type { WalletLinkPanelProps } from './WalletLinkPanel';

/**
 * The per-row Verify affordance for one unverified wallet.
 *
 * v1.3: a connected wallet and a pasted EVM address can be verified from
 * Holdings by **connecting the wallet that controls the address and signing the
 * server-issued challenge**. This component performs only the browser half and
 * reuses the injected `onBegin` / `onComplete` callbacks — front 03's ownership
 * interface — so it re-implements no challenge, verification or write.
 *
 * The controlling-address check is client-side and case-insensitive: the
 * connected address is compared with the row's address, and if the wrong wallet
 * is connected the row says so instead of asking it to sign. The check is a
 * convenience, not the authority: 03 still decides whether a signature verifies.
 *
 * AppKit/wagmi are only reachable through this component, which is mounted only
 * where the resident-facing panel already requires a configured project id, so
 * the unconfigured path never calls a hook.
 */

export interface VerifyUnverifiedWalletProps {
  readonly wallet: UnverifiedHoldingWallet;
  readonly configured: boolean;
  readonly onBegin: WalletLinkPanelProps['onBegin'];
  readonly onComplete: WalletLinkPanelProps['onComplete'];
  /** Called after a successful verification so the page can refresh. */
  readonly onLinked: () => void;
}

/** One live wagmi connection, as `useConnections` reports it. */
type WalletConnection = ReturnType<typeof useConnections>[number];
/** The account type wagmi reports for a connection (a checksummed address). */
type WalletAddress = WalletConnection['accounts'][number];

/** The distinct connected addresses, in connection order, case-insensitive. */
function liveAddresses(
  connections: readonly WalletConnection[],
): WalletAddress[] {
  const seen = new Set<string>();
  const addresses: WalletAddress[] = [];
  for (const connection of connections) {
    for (const account of connection.accounts) {
      const key = account.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      addresses.push(account);
    }
  }
  return addresses;
}

/**
 * Gate the AppKit/wagmi hooks exactly as `WalletLinkPanel` does: when wallet
 * connection is not configured, render a locked, non-interactive control and
 * never reach a hook, so the unconfigured path cannot throw.
 */
export function VerifyUnverifiedWallet(props: VerifyUnverifiedWalletProps) {
  if (!props.configured) return <LockedVerify />;
  return <ConfiguredVerify {...props} />;
}

function LockedVerify() {
  return (
    <LockedAction
      height={32}
      reason="Wallet connection is not configured in this environment."
      style={{ fontSize: '12.5px', padding: '0 14px' }}
    >
      Verify
    </LockedAction>
  );
}

function ConfiguredVerify({
  wallet,
  onBegin,
  onComplete,
  onLinked,
}: Omit<VerifyUnverifiedWalletProps, 'configured'>) {
  const connections = useConnections();
  const { signMessageAsync } = useSignMessage();

  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = liveAddresses(connections);
  const controlling =
    connected.find(
      (address) => address.trim().toLowerCase() === wallet.address.toLowerCase(),
    ) ?? null;

  async function handleVerify() {
    if (busy || verified) return;
    setError(null);

    if (!controlling) {
      setError(
        connected.length === 0
          ? `Connect the wallet that controls ${shortAddress(
              wallet.address,
            )} to verify it.`
          : `Connect the wallet that controls ${shortAddress(
              wallet.address,
            )} — the connected wallet ${connected
              .map(shortAddress)
              .join(', ')} does not control it.`,
      );
      return;
    }

    setBusy(true);
    try {
      const challenge = await onBegin(controlling);
      const signature = await signMessageAsync({
        account: controlling,
        message: challenge.message,
      });
      const result = await onComplete({
        address: controlling,
        message: challenge.message,
        signature,
      });
      if (!result.ok) {
        throw new Error(
          'The signature did not verify; the wallet was not verified.',
        );
      }
      setVerified(true);
      onLinked();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The wallet could not be verified. Nothing was saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (verified) {
    return (
      <Chip tone="success" dot>
        Verified · refreshing
      </Chip>
    );
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
        onClick={() => void handleVerify()}
        disabled={busy}
        title={`Connect the wallet that controls ${wallet.address} and sign to verify it.`}
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
        {busy ? 'Signing…' : 'Verify'}
      </button>
      {error ? (
        <span role="alert" style={{ fontSize: '12px', color: tokens.danger }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
