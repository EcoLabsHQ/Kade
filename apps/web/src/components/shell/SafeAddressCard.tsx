import Link from 'next/link';
import { tokens } from '@/components/ui/tokens';
import { GearGlyph } from '@/components/icons/GearGlyph';
import type { SafeDeploymentStatus } from '@/lib/safe/manifest';

export interface SafeAddressCardProps {
  /**
   * The resident's Safe address. Counterfactual before deployment, deployed
   * after — both are the resident's account, so both are shown.
   */
  readonly address: string | null;
  readonly network?: string;
  /** True once the Safe contract exists on chain. */
  readonly deployed?: boolean;
  /** The record's status, so a failure reads differently from "still pending". */
  readonly status?: SafeDeploymentStatus | null;
  /** Block explorer base, e.g. `https://sepolia.etherscan.io`. */
  readonly explorerUrl?: string | null;
}

/**
 * The reference's Safe account card.
 *
 * The address is never fabricated: it is either the resident's derived address
 * or nothing at all.
 *
 * **The account exists from the moment the passkey does.** Under Safe's passkey
 * model the Safe is counterfactual until its first user operation, which is a
 * normal state rather than a fault — so the card reads "created" either way, and
 * the difference surfaces on the link:
 *
 *   - not deployed yet: the address is shown but is not a link, and hovering it
 *     explains that it appears on chain with the first operation;
 *   - deployed: it links out, so the state can be checked against the chain
 *     rather than taken on trust.
 *
 * There is no retry here any more. Nothing in this step can fail to deploy: there
 * is no deployment in it, and the first operation deploys the account when the
 * paymaster sponsors it.
 */
export function SafeAddressCard({
  address,
  network = 'Ethereum Sepolia',
  deployed = false,
  status = null,
  explorerUrl = null,
}: SafeAddressCardProps) {
  const hasAddress = address !== null && address.length > 0;
  const href =
    hasAddress && deployed && explorerUrl
      ? `${explorerUrl}/address/${address}`
      : null;

  const stateLabel = !hasAddress
    ? 'no account yet'
    : status === 'failed'
      ? 'setup needs another try'
      : 'created';

  /** Shown on hover, and the reason the address is not a link yet. */
  const help = !hasAddress
    ? 'No account address is available for this session.'
    : status === 'failed'
      ? 'Setting up your account did not finish. Try again from this step.'
      : deployed
        ? 'Your account is on chain. Open it in the explorer.'
        : 'Your account is created. It appears on chain with your first ' +
          'operation — Kade covers the network fee for it, so there is nothing ' +
          'to do now.';

  const addressStyle = {
    fontSize: '12.5px',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums' as const,
    color: hasAddress ? tokens.ink : tokens.muted,
    textDecoration: 'none',
    display: 'inline-block',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  };

  return (
    <div
      style={{
        background: tokens.surface,
        border: `1px solid ${tokens.border}`,
        borderRadius: '12px',
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          background: `linear-gradient(135deg, ${tokens.brandPrimary}, #8FC2FF)`,
          flex: '0 0 auto',
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div title={help}>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              style={addressStyle}
              title={help}
            >
              {address}
            </a>
          ) : (
            <span style={{ ...addressStyle, cursor: 'help' }} title={help}>
              {hasAddress ? address : '0x…'}
            </span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: tokens.muted }} title={help}>
          {hasAddress
            ? `Safe · ${stateLabel} · ${network}`
            : `Safe · no account yet · ${network}`}
        </div>
      </div>
      <Link
        href="/account"
        aria-label="Account settings"
        title="Account settings"
        style={{
          flex: '0 0 auto',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '28px',
          height: '28px',
          borderRadius: '8px',
          color: tokens.muted,
          textDecoration: 'none',
        }}
      >
        <GearGlyph size={16} />
      </Link>
    </div>
  );
}
