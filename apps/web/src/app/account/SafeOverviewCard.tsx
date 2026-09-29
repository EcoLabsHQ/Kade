import type { CSSProperties } from 'react';
import { Card } from '@/components/ui/Card';
import { Chip, type ChipTone } from '@/components/ui/Chip';
import { CopyableValue } from '@/components/ui/CopyableValue';
import { tokens } from '@/components/ui/tokens';
import { addressExplorerUrl } from '@/lib/wealth/explorer';
import type { SafeDeploymentStatus } from '@/lib/safe/manifest';
import { safeAppUrl, safeChainForExplorer } from './safe-overview';

export interface SafeOverviewCardProps {
  /** The resident's Safe address, counterfactual or deployed; null if none. */
  readonly address: string | null;
  /** True once the Safe contract exists on chain. */
  readonly deployed: boolean;
  /** The record's status, so "predicted" and "failed" read differently. */
  readonly status: SafeDeploymentStatus | null;
  /** Block-explorer base for the chain the Safe is recorded on. */
  readonly explorerUrl: string | null;
}

/** The resident-facing label and chip tone for a recorded deployment status. */
function statusPresentation(
  address: string | null,
  deployed: boolean,
  status: SafeDeploymentStatus | null,
): { readonly label: string; readonly tone: ChipTone } {
  if (!address) return { label: 'No Safe yet', tone: 'muted' };
  if (deployed) return { label: 'Deployed', tone: 'success' };
  switch (status) {
    case 'failed':
      return { label: 'Deployment did not finish', tone: 'danger' };
    case 'queued':
      return { label: 'Deployment queued · not deployed yet', tone: 'warning' };
    case 'predicted':
      return { label: 'Predicted · not deployed yet', tone: 'warning' };
    default:
      return { label: 'Not deployed yet', tone: 'warning' };
  }
}

/**
 * The Safe overview on the account / passkey screen.
 *
 * The Safe is the resident's real account: it exists from the moment the passkey
 * does and is deployed (counterfactually) by its first sponsored user operation,
 * so this card never gates on `deployed`. With a recorded address it shows the
 * address, an honest status, and two links that work whether or not the contract
 * is on chain yet:
 *
 *   - the address, copyable and openable on its block explorer (`CopyableValue`);
 *   - the Safe{Wallet} web app, where the counterfactual account can be inspected.
 *
 * With no recorded Safe it says so and renders no address and no link — never a
 * fake address or a broken URL.
 */
export function SafeOverviewCard({
  address,
  deployed,
  status,
  explorerUrl,
}: SafeOverviewCardProps) {
  const addressValue = address && address.length > 0 ? address : null;
  const chain = safeChainForExplorer(explorerUrl);
  const safeAppHref = safeAppUrl(explorerUrl, addressValue);
  // Same per-address URL helper the rest of the app uses, so the explorer path
  // is not re-derived here.
  const explorerAddressHref =
    addressValue && chain
      ? addressExplorerUrl(chain.chainId, addressValue)
      : null;
  const { label, tone } = statusPresentation(addressValue, deployed, status);

  return (
    <Card radius={14}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
          Your Safe
        </h2>
        <Chip tone={tone}>{label}</Chip>
      </div>

      {addressValue ? (
        <>
          <p style={blurb}>
            The account that holds your Kade assets. It is created with your
            passkey and appears on chain with your first operation
            {chain ? `, on ${chain.name}` : ''}.
          </p>

          <CopyableValue
            value={addressValue}
            label="Safe address"
            explorerUrl={explorerAddressHref}
            testId="safe-overview-address"
          />

          {safeAppHref ? (
            <div style={{ marginTop: '12px' }}>
              <a
                href={safeAppHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open your Safe in Safe{Wallet}"
                style={link}
              >
                Open in Safe{'{'}Wallet{'}'} ↗
              </a>
            </div>
          ) : null}

          {deployed ? null : (
            <p style={blurb}>
              It is not deployed yet: the address is ready to receive funds now,
              and the links above work in the meantime. The contract is deployed
              by the first operation, whose network fee Kade sponsors.
            </p>
          )}
        </>
      ) : (
        <p style={{ ...blurb, marginBottom: 0 }}>
          No Safe account yet. Create your transaction passkey above and your
          Safe address will appear here.
        </p>
      )}
    </Card>
  );
}

const blurb: CSSProperties = {
  margin: '10px 0 12px',
  fontSize: '12.5px',
  lineHeight: 1.6,
  color: tokens.muted,
};

const link: CSSProperties = {
  color: tokens.brandPrimary,
  fontFamily: 'inherit',
  fontSize: '12.5px',
  fontWeight: 600,
  textDecoration: 'none',
};
