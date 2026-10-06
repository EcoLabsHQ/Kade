'use client';

import type { CSSProperties } from 'react';
import { FullScreenReveal } from './FullScreenReveal';
import { formatIssueDate } from './artifact-format';

/**
 * The virtual Colosseum citizenship passport, revealed full-screen when the
 * resident becomes a citizen (and re-openable from the inline artifact).
 *
 * It is the same declared demo as the inline passport: it confers no real
 * travel or identity document and carries a "Demo" chip and an explicit
 * disclaimer. The full-screen shell is shared with the residency pass
 * (`FullScreenReveal`), so the dialog contract lives in one place.
 */
export interface CitizenshipPassportProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly serial: string | null;
  readonly issuedAt: string | null;
}

export function CitizenshipPassport({
  open,
  onClose,
  serial,
  issuedAt,
}: CitizenshipPassportProps) {
  return (
    <FullScreenReveal
      open={open}
      onClose={onClose}
      title="Virtual citizenship passport"
      announcement="Your demo Colosseum citizenship passport is ready. This is a demo and is not a real travel or identity document."
      revealClassName="kade-passport-reveal"
      flipClassName="kade-passport-flip"
    >
      <div data-testid="colosseum-passport-overlay" style={passportCard}>
        <div aria-hidden className="kade-passport-guilloche" style={passportTexture} />
        <div aria-hidden style={passportEmblem}>
          ✦
        </div>

        <div style={passportHeader}>
          <div style={passportOrg}>Colosseum · Demo Passport</div>
          <div style={passportType}>Citizen</div>
        </div>

        <div style={passportTitleRow}>
          <span style={passportTitle}>Virtual passport</span>
          <span style={passportDocChip}>Demo</span>
        </div>

        <p style={passportNote}>Not a real travel or identity document.</p>

        <dl style={passportFields}>
          <div style={passportField}>
            <dt style={passportLabel}>Document</dt>
            <dd style={passportValue}>Colosseum Citizen</dd>
          </div>
          <div style={passportField}>
            <dt style={passportLabel}>Issued</dt>
            <dd data-testid="colosseum-passport-overlay-issued" style={passportValue}>
              {formatIssueDate(issuedAt)}
            </dd>
          </div>
          <div style={passportField}>
            <dt style={passportLabel}>Serial</dt>
            <dd
              data-testid="colosseum-passport-overlay-serial"
              style={passportValueMono}
            >
              {serial ?? '—'}
            </dd>
          </div>
          <div style={passportField}>
            <dt style={passportLabel}>Status</dt>
            <dd style={passportValue}>Colosseum Citizen · demo</dd>
          </div>
        </dl>

        <div aria-hidden style={passportMrz}>
          <span>P&lt;KADECOLOSSEUM&lt;CITIZEN</span>
          <span>{serial ?? '—'}</span>
        </div>

        <p style={passportDisclaimer}>
          Demo artifact only · confers no status, onchain or otherwise.
        </p>
      </div>
    </FullScreenReveal>
  );
}

const passportCard: CSSProperties = {
  position: 'relative',
  overflow: 'hidden',
  background:
    'radial-gradient(120% 140% at 18% 0%, #12415f 0%, #0a2a43 45%, #071d30 100%)',
  borderRadius: '20px',
  padding: '28px 28px 20px',
  color: '#f4f8ff',
  border: '1px solid rgba(255,255,255,.18)',
  boxShadow:
    '0 1px 0 rgba(255,255,255,.35) inset, 0 -2px 6px rgba(0,0,0,.4) inset, 0 34px 80px -30px rgba(7,29,48,.9)',
  transformStyle: 'preserve-3d',
};

const passportTexture: CSSProperties = {
  position: 'absolute',
  inset: 0,
  opacity: 0.5,
  background:
    'repeating-radial-gradient(circle at 12% 8%, rgba(255,255,255,.10) 0 1px, transparent 1px 12px), repeating-linear-gradient(115deg, rgba(255,255,255,.05) 0 1px, transparent 1px 9px)',
  pointerEvents: 'none',
};

const passportEmblem: CSSProperties = {
  position: 'absolute',
  top: '50%',
  right: '-6px',
  transform: 'translateY(-50%)',
  fontSize: '190px',
  lineHeight: 1,
  color: 'rgba(255,255,255,.05)',
  pointerEvents: 'none',
};

const passportHeader: CSSProperties = {
  position: 'relative',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '10px',
  borderBottom: '1px solid rgba(255,255,255,.2)',
  paddingBottom: '12px',
};

const passportOrg: CSSProperties = {
  fontSize: '10.5px',
  fontWeight: 700,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  opacity: 0.85,
};

const passportType: CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  padding: '3px 8px',
  borderRadius: '999px',
  background: 'rgba(255,255,255,.12)',
  border: '1px solid rgba(255,255,255,.25)',
};

const passportTitleRow: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '10px',
  marginTop: '18px',
};

const passportTitle: CSSProperties = {
  fontSize: '26px',
  fontWeight: 700,
  letterSpacing: '.01em',
};

const passportDocChip: CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: '#ffd479',
  border: '1px solid rgba(255,212,121,.5)',
  borderRadius: '6px',
  padding: '2px 7px',
};

const passportNote: CSSProperties = {
  position: 'relative',
  margin: '6px 0 20px',
  fontSize: '12.5px',
  lineHeight: 1.6,
  opacity: 0.82,
};

const passportFields: CSSProperties = {
  position: 'relative',
  margin: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '16px 18px',
};

const passportField: CSSProperties = {
  borderTop: '1px solid rgba(255,255,255,.22)',
  paddingTop: '10px',
};

const passportLabel: CSSProperties = {
  fontSize: '10px',
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  opacity: 0.7,
};

const passportValue: CSSProperties = {
  margin: '5px 0 0',
  fontSize: '15.5px',
  fontWeight: 700,
};

const passportValueMono: CSSProperties = {
  margin: '5px 0 0',
  fontSize: '14px',
  fontWeight: 700,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  letterSpacing: '.04em',
};

const passportMrz: CSSProperties = {
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

const passportDisclaimer: CSSProperties = {
  position: 'relative',
  margin: '12px 0 0',
  fontSize: '10.5px',
  letterSpacing: '.02em',
  opacity: 0.62,
};
