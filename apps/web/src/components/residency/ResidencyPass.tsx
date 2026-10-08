'use client';

import type { CSSProperties } from 'react';
import { FullScreenReveal } from './FullScreenReveal';
import { formatIssueDate } from './artifact-format';

/**
 * The virtual Colosseum residency pass, revealed full-screen when the resident
 * claims residency.
 *
 * Like the rest of the Colosseum layer this is a declared demo: it confers no
 * real residency, status or document, and carries a "Demo" chip and an explicit
 * disclaimer. The resident's name is not available to this component (the real
 * residency snapshot carries no holder name), so it shows a neutral placeholder
 * unless a caller supplies one.
 *
 * Reveal 1 — a five-layer security print. The substrate, seal and portrait
 * layers wipe up behind the credential; the circular guilloche now lives INSIDE
 * the opaque credential so its grid is actually visible, and the credential
 * settles last. Every layer is decorative and `aria-hidden`; the readable
 * credential is the only thing exposed to assistive tech.
 */
export interface ResidencyPassProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly serial: string | null;
  readonly issuedAt: string | null;
  /** The holder's display name; omitted for a neutral placeholder. */
  readonly holderName?: string | null;
  /**
   * The one-time residency-claim celebration, used only for the first, live
   * claim. Every later open (clicking the claimed card) uses the standard tier.
   */
  readonly residencyCelebration?: boolean;
}

const PLACEHOLDER_HOLDER = 'Kade Resident';

/**
 * The shared residency-pass visual. Both the embedded artifact on the Residency
 * screen (shown to a resident exactly as the certificate is shown to a citizen)
 * and the full-screen popup render this same component, so the two cannot drift
 * apart: the header, security print, fields and typography are one source of
 * truth. The only differences are `variant` (scale, and which decorative
 * security layers are mounted) and the motion the full-screen shell wraps it in.
 *
 * This mirrors `CertificateArtifact` for the citizenship certificate: the
 * embedded rendering is compact and sits inside the section, the full rendering
 * is what the full-screen reveal shows. The full variant keeps the five-layer
 * security print (Reveal 1); the embedded one keeps only the credential card
 * with its internal guilloche, so it does not replay the reveal animation in the
 * page.
 */
export interface ResidencyPassArtifactProps {
  readonly serial: string | null;
  readonly issuedAt: string | null;
  /** The holder's display name; omitted for a neutral placeholder. */
  readonly holderName?: string | null;
  /** `embedded` is the compact inline rendering; `full` is the popup. */
  readonly variant?: 'embedded' | 'full';
  /**
   * The pass has not been claimed yet. Renders the same card desaturated and
   * inactive (grey), clearly distinct from the claimed presentation, so the
   * resident sees the reward before claiming it. Never used by the popup.
   */
  readonly unclaimed?: boolean;
}

export function ResidencyPassArtifact({
  serial,
  issuedAt,
  holderName,
  variant = 'full',
  unclaimed = false,
}: ResidencyPassArtifactProps) {
  const full = variant === 'full';
  const idBase = full
    ? 'colosseum-residency-pass-overlay'
    : 'colosseum-residency-pass';
  const holder = (holderName ?? '').trim() || PLACEHOLDER_HOLDER;

  return (
    <div
      data-testid={idBase}
      data-unclaimed={unclaimed ? 'true' : undefined}
      className={[
        full ? 'kade-security-print kade-artifact-card' : 'kade-security-print',
        unclaimed ? 'kade-residency-pass-locked' : null,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {full ? (
        <>
          <div aria-hidden="true" className="kade-security-layer kade-layer-substrate" />
          <div aria-hidden="true" className="kade-security-layer kade-layer-seal">
            <svg
              viewBox="0 0 120 120"
              width="132"
              height="132"
              style={sealSvg}
              aria-hidden="true"
              focusable="false"
            >
              <circle
                className="kade-seal-stroke"
                cx="60"
                cy="60"
                r="46"
                pathLength={100}
                fill="none"
                stroke="rgba(255,255,255,.45)"
                strokeWidth="2"
              />
              <path
                className="kade-seal-stroke"
                d="M38 62 L54 78 L84 44"
                pathLength={100}
                fill="none"
                stroke="rgba(255,255,255,.7)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div aria-hidden="true" className="kade-security-layer kade-layer-portrait">
            <svg
              viewBox="0 0 120 120"
              width="150"
              height="150"
              style={portraitSvg}
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="60" cy="44" r="22" fill="rgba(255,255,255,.16)" />
              <path
                d="M20 110 C24 80 40 70 60 70 C80 70 96 80 100 110 Z"
                fill="rgba(255,255,255,.12)"
              />
            </svg>
          </div>
        </>
      ) : null}

      <div className={full ? 'kade-security-layer kade-layer-credential' : undefined}>
        {/* The `kade-security-credential` class only carries the reveal's settle
            animation, so the embedded card omits it: the inline card must not
            replay reveal motion in the page. */}
        <div
          className={full ? 'kade-security-credential' : undefined}
          style={full ? passCard : embeddedCard}
        >
          {/*
            The circular security grid lives INSIDE the opaque credential, not
            behind it. As a sibling security layer it sat under the credential
            card's opaque background, so it was invisible no matter how opaque
            the layer was. Inside the card it paints above the card background
            and below the positioned text, exactly as the approved baseline.
          */}
          <div
            aria-hidden="true"
            className={
              full ? 'kade-security-layer kade-layer-guilloche' : 'kade-layer-guilloche'
            }
            style={full ? undefined : guillocheLayerEmbedded}
          >
            <div className="kade-residency-pass-guilloche" style={guilloche} />
          </div>
          <div aria-hidden="true" style={emblem}>
            ✦
          </div>

          <div style={header}>
            <div style={org}>Colosseum · Demo Residency Pass</div>
            <div style={typeChip}>{unclaimed ? 'Unclaimed' : 'Resident'}</div>
          </div>

          <div style={titleRow}>
            <span style={full ? title : embeddedTitle}>Virtual residency pass</span>
            <span style={demoChip}>Demo</span>
          </div>

          <p style={note}>Not a real residency, status or document.</p>

          <dl style={fields}>
            <div className="kade-artifact-field" style={field}>
              <dt style={label}>Holder</dt>
              <dd data-testid={`${idBase}-holder`} style={value}>
                {holder}
              </dd>
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
              <dd style={value}>
                {unclaimed
                  ? 'Not claimed yet · demo'
                  : 'Colosseum Resident · demo'}
              </dd>
            </div>
          </dl>

          <div aria-hidden="true" style={mrz}>
            <span>P&lt;KADECOLOSSEUM&lt;RESIDENT</span>
            <span>{serial ?? '—'}</span>
          </div>

          <p style={disclaimer}>
            Demo artifact only · confers no residency, status, onchain or
            otherwise.
          </p>
        </div>
      </div>
    </div>
  );
}

export function ResidencyPass({
  open,
  onClose,
  serial,
  issuedAt,
  holderName,
  residencyCelebration = false,
}: ResidencyPassProps) {
  return (
    <FullScreenReveal
      open={open}
      onClose={onClose}
      title="Colosseum residency pass"
      announcement="Your demo Colosseum residency pass is ready. This is a demo and confers no real status."
      revealClassName="kade-residency-pass-reveal"
      flipClassName="kade-residency-pass-flip"
      residencyCelebration={residencyCelebration}
    >
      <ResidencyPassArtifact
        variant="full"
        serial={serial}
        issuedAt={issuedAt}
        holderName={holderName}
      />
    </FullScreenReveal>
  );
}

const passCard: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  // Never exceed the reveal shell, so the pass cannot spill horizontally.
  maxInlineSize: '100%',
  boxSizing: 'border-box',
  background:
    'radial-gradient(120% 140% at 18% 0%, #12514a 0%, #0a3a38 45%, #062322 100%)',
  borderRadius: '20px',
  padding: '26px 26px 18px',
  color: '#f2fbf8',
  border: '1px solid rgba(255,255,255,.18)',
  boxShadow:
    '0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 6px rgba(0,0,0,.4) inset, 0 34px 80px -30px rgba(4,24,22,.9)',
  transformStyle: 'preserve-3d',
};

/* The embedded rendering fills the trigger wrapper, which spans the Colosseum
   section width (see `.kade-passport-trigger`). The popup is the same component
   bounded by the reveal shell; only the scale differs. */
const embeddedCard: CSSProperties = {
  ...passCard,
  width: '100%',
  borderRadius: '18px',
  padding: '22px 22px 16px',
};

/* The embedded guilloche needs the absolute fill that the full variant gets from
   `.kade-security-layer`, without that class's reveal animation replaying in the
   page. */
const guillocheLayerEmbedded: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 0,
  overflow: 'hidden',
  borderRadius: '18px',
};

const sealSvg: CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  opacity: 0.55,
};

const portraitSvg: CSSProperties = {
  position: 'absolute',
  right: '18px',
  bottom: '12px',
  opacity: 0.6,
};

const guilloche: CSSProperties = {
  position: 'absolute',
  inset: 0,
  opacity: 0.55,
  background:
    'repeating-radial-gradient(circle at 12% 8%, rgba(255,255,255,.10) 0 1px, transparent 1px 13px), repeating-radial-gradient(circle at 88% 92%, rgba(255,255,255,.08) 0 1px, transparent 1px 17px), repeating-linear-gradient(115deg, rgba(255,255,255,.05) 0 1px, transparent 1px 9px)',
  pointerEvents: 'none',
};

const emblem: CSSProperties = {
  position: 'absolute',
  top: '50%',
  right: '-10px',
  transform: 'translateY(-50%)',
  fontSize: '190px',
  lineHeight: 1,
  color: 'rgba(255,255,255,.05)',
  pointerEvents: 'none',
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

const typeChip: CSSProperties = {
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

const title: CSSProperties = {
  fontSize: '26px',
  fontWeight: 700,
  letterSpacing: '.01em',
};

const embeddedTitle: CSSProperties = {
  fontSize: '19px',
  fontWeight: 700,
  letterSpacing: '.01em',
};

const demoChip: CSSProperties = {
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
  color: 'rgba(242,251,248,.72)',
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
