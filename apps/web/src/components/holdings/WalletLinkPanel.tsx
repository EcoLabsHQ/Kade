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
 * wagmi keeps a map of live connections, one per connector, so connecting a
 * second wallet ADDS to the list instead of replacing the first. The panel lists
 * every distinct connected address and gives each its own action, so the
 * resident chooses which address to sign: the address signed is always the row
 * they clicked, never an implicit `connections[0]`. Addresses are deduplicated
 * case-insensitively, and each row keeps its own busy / error / linked state so
 * one failure leaves the others usable.
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

/** One live wagmi connection, as `useConnections` reports it. */
type WalletConnection = ReturnType<typeof useConnections>[number];

/** The account type wagmi reports for a connection (a checksummed address). */
type WalletAddress = WalletConnection['accounts'][number];

/**
 * The distinct addresses across every live connection, in connection order.
 * The first occurrence of an address wins, and addresses that differ only by
 * case are one wallet, so a duplicated connection is not offered twice.
 */
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

/** The case-insensitive key that identifies an address across renders. */
function addressKey(address: string): string {
  return address.trim().toLowerCase();
}

function ConfiguredLinkForm({
  onBegin,
  onComplete,
  onLinked,
}: Omit<WalletLinkPanelProps, 'configured'>) {
  const { open } = useAppKit();
  const connections = useConnections();
  const { signMessageAsync } = useSignMessage();

  // Each row owns its state, keyed by the case-insensitive address, so a busy or
  // failed row never blocks another.
  const [busyKeys, setBusyKeys] = useState<readonly string[]>([]);
  const [linkedKeys, setLinkedKeys] = useState<readonly string[]>([]);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const addresses = liveAddresses(connections);
  const onlyAddress = addresses.length === 1 ? addresses[0] ?? null : null;

  async function handleLink(address: WalletAddress) {
    const key = addressKey(address);
    if (busyKeys.includes(key)) return;
    setBusyKeys((current) => [...current, key]);
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
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
      setLinkedKeys((current) =>
        current.includes(key) ? current : [...current, key],
      );
      onLinked();
    } catch (cause) {
      setErrors((current) => ({
        ...current,
        [key]:
          cause instanceof Error
            ? cause.message
            : 'The wallet could not be linked. Nothing was saved.',
      }));
    } finally {
      setBusyKeys((current) => current.filter((item) => item !== key));
    }
  }

  return (
    <Card padding="14px 16px">
      <div style={{ fontSize: '15px', fontWeight: 600 }}>Link a wallet</div>
      <div style={{ fontSize: '13px', color: tokens.muted, marginTop: '2px' }}>
        {addresses.length === 0
          ? 'Connect a wallet, then sign a challenge to prove control.'
          : onlyAddress
            ? 'Prove control of this connected wallet with a signature.'
            : 'Choose which connected wallet to prove control of.'}
      </div>

      {addresses.length === 0 ? (
        <div style={{ marginTop: '12px' }}>
          <button
            type="button"
            onClick={() => void open({ view: 'Connect' })}
            style={actionButton}
          >
            Connect wallet
          </button>
        </div>
      ) : (
        <ul style={addressList}>
          {addresses.map((address) => {
            const key = addressKey(address);
            const busy = busyKeys.includes(key);
            const isLinked = linkedKeys.includes(key);
            const error = errors[key];
            return (
              <li key={key} style={addressRow}>
                <div style={{ minWidth: 0 }}>
                  <div
                    title={address}
                    style={{
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      fontSize: '13px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {shortAddress(address)}
                  </div>
                  {isLinked ? (
                    <div style={{ marginTop: '6px' }}>
                      <Chip tone="success" dot>
                        Linked · verified signature
                      </Chip>
                    </div>
                  ) : null}
                  {error ? (
                    <div role="alert" style={errorText}>
                      {error}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void handleLink(address)}
                  disabled={busy}
                  style={{
                    ...actionButton,
                    opacity: busy ? 0.6 : 1,
                    cursor: busy ? 'progress' : 'pointer',
                  }}
                >
                  {busy ? 'Signing…' : 'Sign to link'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

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

const addressList: React.CSSProperties = {
  listStyle: 'none',
  margin: '12px 0 0',
  padding: 0,
  display: 'grid',
  gap: '8px',
};

const addressRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
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
