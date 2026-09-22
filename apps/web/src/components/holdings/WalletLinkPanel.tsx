'use client';

import { useState } from 'react';
import { useAppKit } from '@reown/appkit/react';
import { useConnections, useSignMessage } from 'wagmi';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { tokens } from '@/components/ui/tokens';
import { shortAddress } from '@/lib/wealth/format';

/**
 * Link a wallet by proving control with a signature.
 *
 * Frozen decision §2.2 item 2: a linked wallet is proven by signing a
 * server-issued challenge, EIP-191 / EIP-4361-style. This panel performs the
 * browser half only — request the challenge, sign the exact message, submit the
 * signature — and calls the injected `onBegin` / `onComplete` callbacks for the
 * server half. Those callbacks are front 03's ownership interface, wired in by
 * the Holdings page, so this component holds no proof logic and its tests never
 * need 03.
 *
 * The signature confers no Safe authority and is not a login. The panel only
 * obtains proof; the server (03) is the authority on whether it verifies.
 *
 * As in `ConnectedWalletPanel`, the AppKit and wagmi hooks are isolated in
 * `ConfiguredLinkForm`, mounted only when a WalletConnect project id exists, so
 * an unconfigured environment renders static markup instead of throwing.
 */

export interface OwnershipChallengeView {
  /** The exact challenge message the wallet must sign. */
  readonly message: string;
}

export interface WalletLinkPanelProps {
  readonly configured: boolean;
  /** Server callback: issue a challenge for this address (front 03). */
  readonly onBegin: (address: string) => Promise<OwnershipChallengeView>;
  /** Server callback: verify and persist the signature (front 03). */
  readonly onComplete: (input: {
    readonly address: string;
    readonly message: string;
    readonly signature: string;
  }) => Promise<{ readonly ok: boolean }>;
  /** Called after a successful verification so the page can refresh. */
  readonly onLinked: () => void;
}

export function WalletLinkPanel({
  configured,
  onBegin,
  onComplete,
  onLinked,
}: WalletLinkPanelProps) {
  if (!configured) return <UnconfiguredLinkPanel />;
  return (
    <ConfiguredLinkForm
      onBegin={onBegin}
      onComplete={onComplete}
      onLinked={onLinked}
    />
  );
}

function UnconfiguredLinkPanel() {
  return (
    <Card padding="14px 16px">
      <div style={{ fontSize: '15px', fontWeight: 600 }}>Link a wallet</div>
      <div style={{ fontSize: '13px', color: tokens.muted, marginTop: '2px' }}>
        Prove control with a signature to show a wallet&rsquo;s holdings.
      </div>
      <button
        type="button"
        disabled
        title="Wallet connection is not configured in this environment."
        style={{
          ...actionButton,
          marginTop: '12px',
          opacity: 0.5,
          cursor: 'not-allowed',
        }}
      >
        Link a wallet
      </button>
      <p style={mutedNote}>
        Wallet connection is not configured here, so a wallet cannot be linked
        by signature. Pasted addresses stay registration-only and never appear in
        Holdings.
      </p>
    </Card>
  );
}

function ConfiguredLinkForm({
  onBegin,
  onComplete,
  onLinked,
}: Omit<WalletLinkPanelProps, 'configured'>) {
  const { open } = useAppKit();
  const connections = useConnections();
  const { signMessageAsync } = useSignMessage();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);

  const address = connections[0]?.accounts[0] ?? null;

  async function handleLink() {
    if (!address || busy) return;
    setBusy(true);
    setError(null);
    setLinked(false);
    try {
      const challenge = await onBegin(address);
      const signature = await signMessageAsync({
        account: address,
        message: challenge.message,
      });
      const result = await onComplete({
        address,
        message: challenge.message,
        signature,
      });
      if (!result.ok) {
        throw new Error(
          'The signature did not verify; the wallet was not linked.',
        );
      }
      setLinked(true);
      onLinked();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The wallet could not be linked. Nothing was saved.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding="14px 16px">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>Link a wallet</div>
          <div
            style={{
              fontSize: '13px',
              color: tokens.muted,
              fontFamily: address ? 'ui-monospace, Menlo, monospace' : undefined,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {address
              ? `Sign a challenge for ${shortAddress(address)}`
              : 'Connect a wallet, then sign a challenge to prove control.'}
          </div>
        </div>
        {address ? (
          <button
            type="button"
            onClick={handleLink}
            disabled={busy}
            style={{
              ...actionButton,
              opacity: busy ? 0.6 : 1,
              cursor: busy ? 'progress' : 'pointer',
            }}
          >
            {busy ? 'Signing…' : 'Sign to link'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void open({ view: 'Connect' })}
            style={actionButton}
          >
            Connect wallet
          </button>
        )}
      </div>

      {linked ? (
        <div style={{ marginTop: '10px' }}>
          <Chip tone="success" dot>
            Linked · verified signature
          </Chip>
        </div>
      ) : null}

      {error ? (
        <div role="alert" style={{ ...errorText }}>
          {error}
        </div>
      ) : null}

      <p style={mutedNote}>
        You sign a message, not a transaction. The signature proves you control
        the address, is not a login, and gives Kade no authority over your Safe.
      </p>
    </Card>
  );
}

const actionButton: React.CSSProperties = {
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
  margin: '10px 0 0',
};

const errorText: React.CSSProperties = {
  marginTop: '8px',
  fontSize: '12.5px',
  color: tokens.danger,
};
