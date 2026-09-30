'use client';

import { tokens } from '@/components/ui/tokens';
import { useAccountMenu, UserMenu } from './UserMenu';
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
  /**
   * Whether the user has a reviewers row, so the card's account menu can offer
   * `/admin`. The card is the account menu's trigger, so it owns this.
   */
  readonly isReviewer?: boolean;
}

/**
 * The reference's Safe account card — and, since the avatar-only button was
 * removed, the account menu's trigger.
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
 *
 * **Clicking the card opens the account menu.** The card keeps its text (the
 * address and the network line), so unlike the avatar-only button it replaced it
 * cannot be the `<button>` itself without nesting the deployed address link. It
 * uses the stretched-trigger pattern instead: an absolutely positioned
 * `<button>` covers the card, and the deployed address link is raised above it so
 * it stays clickable. The trigger carries the accessible name `Account` and
 * advertises the menu with `aria-haspopup`/`aria-expanded`. A `▾` in the gear's
 * old slot is the visible affordance that the card opens something; the whole
 * card also shows the pointer cursor and takes the browser's focus ring, so it
 * still reads as clickable.
 */
export function SafeAddressCard({
  address,
  network = 'Ethereum Sepolia',
  deployed = false,
  status = null,
  explorerUrl = null,
  isReviewer = false,
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

  const { open, containerRef, triggerRef, toggle, close } = useAccountMenu();

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
      ref={containerRef}
      data-testid="safe-address-card"
      style={{
        position: 'relative',
        // Keep the trigger and the menu in their own stacking context, so the
        // trigger's z-index cannot leak over the menu or its siblings.
        isolation: 'isolate',
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
              // Above the stretched trigger: the address still opens the chain,
              // while clicking anywhere else on the card opens the menu.
              style={{ ...addressStyle, position: 'relative', zIndex: 2 }}
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
      {/* The gear's old slot: a menu affordance, so the card still reads as
          clickable once the standalone gear is gone. */}
      <span
        aria-hidden
        style={{
          flex: '0 0 auto',
          color: tokens.muted,
          fontSize: '11px',
          lineHeight: 1,
        }}
      >
        ▾
      </span>
      {/*
        The stretched trigger. It sits under the address link (z-index 2) so the
        link keeps working, and under nothing else: the card is the control.
      */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        title={help}
        onClick={toggle}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          margin: 0,
          padding: 0,
          border: 0,
          background: 'transparent',
          borderRadius: '12px',
          cursor: 'pointer',
          font: 'inherit',
          color: 'inherit',
        }}
      />
      {open ? <UserMenu isReviewer={isReviewer} onClose={close} /> : null}
    </div>
  );
}
