import { tokens } from '@/components/ui/tokens';
import type { SafeDeploymentStatus } from '@/lib/safe/manifest';
import { SafeRetryButton } from './SafeRetryButton';

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
 * or nothing at all. Before deployment it is still shown, because a
 * counterfactual address is the resident's account — it is simply not a contract
 * yet, and the card says which of the two it is.
 *
 * When an explorer base is supplied the address links out, so the state can be
 * checked against the chain rather than taken on trust. When the Safe is not
 * deployed the card offers a retry, which is the resident's route back from a
 * failed setup without creating a second passkey.
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
    hasAddress && explorerUrl ? `${explorerUrl}/address/${address}` : null;

  const stateLabel = !hasAddress
    ? 'no account yet'
    : deployed
      ? 'deployed'
      : status === 'failed'
        ? 'setup needs another try'
        : 'not deployed';

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
        <div
          title={
            hasAddress
              ? deployed
                ? 'Deployed Safe address'
                : 'Your Safe address. The contract is not deployed yet.'
              : 'No account address is available for this session'
          }
        >
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              style={addressStyle}
            >
              {address}
            </a>
          ) : (
            <span style={addressStyle}>{hasAddress ? address : '0x…'}</span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: tokens.muted }}>
          {hasAddress
            ? `Safe · ${stateLabel} · ${network}`
            : `Safe · no account yet · ${network}`}
        </div>
        {hasAddress && !deployed ? <SafeRetryButton /> : null}
      </div>
    </div>
  );
}
