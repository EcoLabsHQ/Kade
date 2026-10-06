'use client';

import type { CSSProperties } from 'react';
import { FullScreenReveal } from './FullScreenReveal';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { formatIssueDate } from './artifact-format';

/**
 * The virtual Colosseum citizenship certificate, revealed full-screen when the
 * resident becomes a citizen (and re-openable from the inline artifact).
 *
 * It is the same declared demo as the inline certificate: it confers no real
 * citizenship, status or identity document and carries a "Demo" chip and an
 * explicit disclaimer. The full-screen shell is shared with the residency pass
 * (`FullScreenReveal`), so the dialog contract lives in one place.
 *
 * Reveal 2 — a three-layer 3D stack. Two decorative document layers rise out of
 * depth and consolidate behind the credential; the credential's fields then
 * stagger in and a single security-light pass crosses it once.
 */

/**
 * The shared certificate visual. Both the embedded artifact on the Residency
 * screen and the full-screen popup render this same component so they cannot
 * drift apart: the header, texture, field structure and typography are one
 * source of truth, and the only difference is `variant` (scale) and the motion
 * the full-screen shell wraps it in.
 */
export interface CertificateArtifactProps {
  readonly serial: string | null;
  readonly issuedAt: string | null;
  /** `embedded` is the compact inline rendering; `full` is the popup. */
  readonly variant?: 'embedded' | 'full';
  /** Render the one-shot security-light pass (full-screen only). */
  readonly showSweep?: boolean;
}

export function CertificateArtifact({
  serial,
  issuedAt,
  variant = 'full',
  showSweep = false,
}: CertificateArtifactProps) {
  const full = variant === 'full';
  const idBase = full ? 'colosseum-certificate-overlay' : 'colosseum-certificate';

  return (
    <div
      data-testid={full ? 'colosseum-certificate-overlay' : 'colosseum-certificate'}
      className={
        full
          ? 'kade-certificate-artifact kade-artifact-card'
          : 'kade-certificate-artifact'
      }
      style={full ? fullCard : embeddedCard}
    >
      <div aria-hidden="true" className="kade-passport-guilloche" style={texture} />
      <div aria-hidden="true" style={full ? fullEmblem : embeddedEmblem}>
        ✦
      </div>
      {showSweep ? (
        <span aria-hidden="true" className="kade-passport-sweep" />
      ) : null}

      <div style={header}>
        <div style={org}>Colosseum · Demo Certificate</div>
        <div style={type}>Citizen</div>
      </div>

      <div style={titleRow}>
        <span style={full ? fullTitle : embeddedTitle}>
          Colosseum Citizenship Certificate
        </span>
        <span style={docChip}>Demo</span>
      </div>

      <p style={note}>Not a real citizenship, status or identity document.</p>

      <dl style={fields}>
        <div className="kade-artifact-field" style={field}>
          <dt style={label}>Document</dt>
          <dd style={value}>Colosseum Citizen</dd>
        </div>
        <div className="kade-artifact-field" style={field}>
          <dt style={label}>Issued</dt>
          <dd data-testid={`${idBase}-issued`} style={value}>
            {formatIssueDate(issuedAt)}
          </dd>
        </div>
        <div className="kade-artifact-field" style={field}>
          <dt style={label}>Serial</dt>
          <dd data-testid={`${idBase}-serial`} style={valueMono}>
            {serial ?? '—'}
          </dd>
        </div>
        <div className="kade-artifact-field" style={field}>
          <dt style={label}>Status</dt>
          <dd style={value}>Colosseum Citizen · demo</dd>
        </div>
      </dl>

      <div aria-hidden="true" style={mrz}>
        <span>P&lt;KADECOLOSSEUM&lt;CITIZEN</span>
        <span data-testid={`${idBase}-mrz`}>{serial ?? '—'}</span>
      </div>

      <p style={disclaimer}>
        Demo artifact only · confers no status, onchain or otherwise.
      </p>
    </div>
  );
}

export interface CitizenshipCertificateProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly serial: string | null;
  readonly issuedAt: string | null;
  /**
   * The one-time celebratory tier, used only for the first, live transition to
   * citizen. Every later open (e.g. clicking the inline certificate) uses the
   * standard tier.
   */
  readonly celebration?: boolean;
}

export function CitizenshipCertificate({
  open,
  onClose,
  serial,
  issuedAt,
  celebration = false,
}: CitizenshipCertificateProps) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <FullScreenReveal
      open={open}
      onClose={onClose}
      title="Colosseum Citizenship Certificate"
      announcement="Your demo Colosseum citizenship certificate is ready. This is a demo and is not a real identity document."
      revealClassName="kade-passport-reveal"
      flipClassName="kade-passport-flip"
      celebration={celebration}
    >
      <div className="kade-passport-stack" data-testid="colosseum-certificate-overlay-stack">
        <div aria-hidden="true" className="kade-stack-layer kade-stack-back" style={stackBack} />
        <div aria-hidden="true" className="kade-stack-layer kade-stack-mid" style={stackMid} />
        <div className="kade-stack-layer kade-stack-front">
          <CertificateArtifact
            variant="full"
            serial={serial}
            issuedAt={issuedAt}
            showSweep={!reducedMotion}
          />
        </div>
      </div>
    </FullScreenReveal>
  );
}

const baseCard: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  // Never exceed the reveal shell, so the certificate cannot spill horizontally.
  maxInlineSize: '100%',
  boxSizing: 'border-box',
  background:
    'radial-gradient(120% 140% at 18% 0%, #12415f 0%, #0a2a43 45%, #071d30 100%)',
  color: '#f4f8ff',
  border: '1px solid rgba(255,255,255,.18)',
  transformStyle: 'preserve-3d',
};

const fullCard: CSSProperties = {
  ...baseCard,
  borderRadius: '20px',
  padding: '28px 28px 20px',
  boxShadow:
    '0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 6px rgba(0,0,0,.4) inset, 0 34px 80px -30px rgba(7,29,48,.9)',
};

const embeddedCard: CSSProperties = {
  ...baseCard,
  borderRadius: '18px',
  padding: '22px 22px 16px',
  boxShadow:
    '0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 6px rgba(0,0,0,.4) inset, 0 26px 60px -26px rgba(7,29,48,.8)',
};

const stackBack: CSSProperties = {
  borderRadius: '20px',
  background: 'radial-gradient(120% 140% at 18% 0%, #0d2f47 0%, #071d30 100%)',
  border: '1px solid rgba(255,255,255,.12)',
};

const stackMid: CSSProperties = {
  borderRadius: '20px',
  background: 'radial-gradient(120% 140% at 18% 0%, #10344f 0%, #08202f 100%)',
  border: '1px solid rgba(255,255,255,.14)',
};

const texture: CSSProperties = {
  position: 'absolute',
  inset: 0,
  opacity: 0.5,
  background:
    'repeating-radial-gradient(circle at 12% 8%, rgba(255,255,255,.10) 0 1px, transparent 1px 12px), repeating-linear-gradient(115deg, rgba(255,255,255,.05) 0 1px, transparent 1px 9px)',
  pointerEvents: 'none',
};

const fullEmblem: CSSProperties = {
  position: 'absolute',
  top: '50%',
  right: '-6px',
  transform: 'translateY(-50%)',
  fontSize: '190px',
  lineHeight: 1,
  color: 'rgba(255,255,255,.05)',
  pointerEvents: 'none',
};

const embeddedEmblem: CSSProperties = {
  ...fullEmblem,
  fontSize: '150px',
};

const header: CSSProperties = {
  position: 'relative',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '10px',
  borderBottom: '1px solid rgba(255,255,255,.2)',
  paddingBottom: '12px',
};

const org: CSSProperties = {
  fontSize: '10.5px',
  fontWeight: 700,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  opacity: 0.85,
};

const type: CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  padding: '3px 8px',
  borderRadius: '999px',
  background: 'rgba(255,255,255,.12)',
  border: '1px solid rgba(255,255,255,.25)',
};

const titleRow: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '10px',
  marginTop: '18px',
};

const fullTitle: CSSProperties = {
  fontSize: '24px',
  fontWeight: 700,
  letterSpacing: '.01em',
};

const embeddedTitle: CSSProperties = {
  fontSize: '19px',
  fontWeight: 700,
  letterSpacing: '.01em',
};

const docChip: CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: '#ffd479',
  border: '1px solid rgba(255,212,121,.5)',
  borderRadius: '6px',
  padding: '2px 7px',
};

const note: CSSProperties = {
  position: 'relative',
  margin: '6px 0 20px',
  fontSize: '12.5px',
  lineHeight: 1.6,
  opacity: 0.82,
};

const fields: CSSProperties = {
  position: 'relative',
  margin: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '16px 18px',
};

const field: CSSProperties = {
  borderTop: '1px solid rgba(255,255,255,.22)',
  paddingTop: '10px',
};

const label: CSSProperties = {
  fontSize: '10px',
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  opacity: 0.7,
};

const value: CSSProperties = {
  margin: '5px 0 0',
  fontSize: '15.5px',
  fontWeight: 700,
};

const valueMono: CSSProperties = {
  margin: '5px 0 0',
  fontSize: '14px',
  fontWeight: 700,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  letterSpacing: '.04em',
};

const mrz: CSSProperties = {
  position: 'relative',
  marginTop: '20px',
  display: 'flex',
  justifyContent: 'space-between',
  gap: '10px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '10.5px',
  letterSpacing: '.18em',
  color: 'rgba(244,248,255,.72)',
  borderTop: '1px dashed rgba(255,255,255,.28)',
  paddingTop: '10px',
};

const disclaimer: CSSProperties = {
  position: 'relative',
  margin: '12px 0 0',
  fontSize: '10.5px',
  letterSpacing: '.02em',
  opacity: 0.62,
};
