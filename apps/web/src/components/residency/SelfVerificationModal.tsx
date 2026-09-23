'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { tokens } from '@/components/ui/tokens';

/**
 * The Self handoff dialog from the deployed baseline.
 *
 * A preview of the Self flow: the resident scans their passport's NFC chip in
 * the Self app, which produces a zero-knowledge proof of the facts Kade needs.
 * The copy, the QR and the "what we learn" table are the reference's.
 *
 * Confirming runs the real server action (which reports the gate in this
 * build); the dialog fabricates no verification result.
 */

export interface SelfVerificationModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

/** The reference's deterministic 11×11 QR pattern, reproduced exactly. */
function qrCells(): readonly string[] {
  const out: string[] = [];
  let seed = 7;
  for (let i = 0; i < 121; i += 1) {
    const r = Math.floor(i / 11);
    const c = i % 11;
    const finder = (r < 3 && c < 3) || (r < 3 && c > 7) || (r > 7 && c < 3);
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out.push(finder ? '#101828' : (seed >> 8) % 100 < 46 ? '#101828' : '#fff');
  }
  return out;
}

const QR = qrCells();

const FACTS: readonly {
  readonly label: string;
  readonly value: string;
  readonly green?: boolean;
}[] = [
  { label: 'Nationality', value: 'disclosed · DE' },
  { label: 'Over 18', value: 'proven · true' },
  { label: 'Not on OFAC list', value: 'proven · true' },
  { label: 'Uniqueness', value: 'nullifier, one per passport' },
  { label: 'Passport number, photo, DOB', value: 'never shared', green: true },
];

export function SelfVerificationModal({
  open,
  onClose,
  onConfirm,
}: SelfVerificationModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div onClick={onClose} style={backdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Verify your identity"
        onClick={(event) => event.stopPropagation()}
        style={card}
      >
        <div style={header}>
          <div>
            <div style={eyebrow}>Verify your identity</div>
            <div style={{ fontSize: '15px', fontWeight: 700, marginTop: '4px' }}>
              Powered by Self
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={closeButton}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '22px' }}>
          <div style={bodyCopy}>
            Scan your passport&rsquo;s NFC chip in the Self app. It generates a
            zero-knowledge proof of the facts we need — nationality, age,
            sanctions status — without sending us your passport or your name.
          </div>

          <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center' }}>
            <div style={qrFrame}>
              <div style={qrGrid}>
                {QR.map((color, index) => (
                  <span key={index} style={{ background: color, borderRadius: '1px' }} />
                ))}
              </div>
              <div style={qrBadgeWrap}>
                <span style={qrBadge}>S</span>
              </div>
            </div>
          </div>

          <div style={qrCaption}>
            Open the Self app and scan · or tap to open on this device
          </div>

          <div style={whatLabel}>What we learn</div>
          <div style={factsBox}>
            {FACTS.map((fact) => (
              <div
                key={fact.label}
                style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}
              >
                <span style={{ color: tokens.muted }}>{fact.label}</span>
                <span
                  style={{
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    color: fact.green ? tokens.success : undefined,
                  }}
                >
                  {fact.value}
                </span>
              </div>
            ))}
          </div>

          <div style={infoBox}>
            The proof is verified onchain and written to your account as{' '}
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>kade.kyc.v1</span>{' '}
            — reusable for the card, banking and voting.
          </div>

          <button type="button" onClick={onConfirm} style={confirmButton}>
            I completed the scan in Self
          </button>
          <div style={footnote}>Preview of the Self handoff · self.xyz</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(16,24,40,.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px',
  zIndex: 60,
};

const card: CSSProperties = {
  background: '#fff',
  borderRadius: '18px',
  width: '100%',
  maxWidth: '420px',
  maxHeight: '86vh',
  overflow: 'auto',
  boxShadow: '0 30px 80px -20px rgba(16,24,40,.45)',
  animation: 'fadeUp .16s ease-out',
};

const header: CSSProperties = {
  padding: '18px 22px',
  borderBottom: `1px solid ${tokens.border}`,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '12px',
};

const eyebrow: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const closeButton: CSSProperties = {
  width: '28px',
  height: '28px',
  border: `1px solid ${tokens.border}`,
  background: '#fff',
  borderRadius: '50%',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '14px',
  color: tokens.muted,
  lineHeight: 1,
  flex: '0 0 auto',
};

const bodyCopy: CSSProperties = {
  fontSize: '13.5px',
  color: tokens.chipFg,
  lineHeight: 1.6,
};

const qrFrame: CSSProperties = {
  width: '164px',
  height: '164px',
  background: '#fff',
  border: `1px solid ${tokens.border}`,
  borderRadius: '14px',
  padding: '10px',
  position: 'relative',
};

const qrGrid: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'grid',
  gridTemplateColumns: 'repeat(11, 1fr)',
  gridTemplateRows: 'repeat(11, 1fr)',
  gap: '2px',
};

const qrBadgeWrap: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const qrBadge: CSSProperties = {
  width: '36px',
  height: '36px',
  borderRadius: '10px',
  background: tokens.ink,
  color: '#fff',
  fontSize: '13px',
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '3px solid #fff',
};

const qrCaption: CSSProperties = {
  marginTop: '12px',
  fontSize: '12.5px',
  color: tokens.muted,
  textAlign: 'center',
};

const whatLabel: CSSProperties = {
  marginTop: '16px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const factsBox: CSSProperties = {
  marginTop: '6px',
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
  borderRadius: '12px',
  padding: '14px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  fontSize: '12.5px',
};

const infoBox: CSSProperties = {
  marginTop: '14px',
  background: '#EAF2FC',
  borderRadius: '10px',
  padding: '11px 13px',
  fontSize: '12.5px',
  color: '#0063B5',
};

const confirmButton: CSSProperties = {
  marginTop: '18px',
  width: '100%',
  height: '44px',
  border: 0,
  borderRadius: '999px',
  background: tokens.ink,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: '14.5px',
  fontWeight: 600,
  cursor: 'pointer',
};

const footnote: CSSProperties = {
  marginTop: '10px',
  fontSize: '11.5px',
  color: tokens.muted,
  textAlign: 'center',
};
