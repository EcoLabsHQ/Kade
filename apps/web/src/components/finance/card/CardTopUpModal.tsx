'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { tokens } from '@/components/ui/tokens';

/**
 * The "Top up card" dialog (kade-mvp.dc.html 821–856; screenshots 24/25).
 *
 * This is a **declared presentational mock**: Finance is beyond the frozen
 * Week 2 scope (week-2 contract §2.1). The amount, the deposit address and the
 * network rows are seed demo values, and the footer button only closes the
 * dialog — no server action runs and no USDC moves. The declared divergence
 * lives in `docs/week-3-frozen-delivery-contract.md`; the UI itself renders the
 * reference faithfully and adds no disclosure.
 *
 * The shared `Modal` is not used here because its single-line header cannot
 * carry the reference's eyebrow ("Top up card") above the title
 * ("Onchain Island Card · 4821"); this dialog reproduces that two-line header.
 */

/** The three networks the reference offers for a card deposit. */
const DEPOSIT_CHAINS = [
  { name: 'Ethereum', color: '#627EEA' },
  { name: 'Base', color: '#0052FF' },
  { name: 'Arbitrum', color: '#2D374B' },
] as const;

type DepositChain = (typeof DEPOSIT_CHAINS)[number]['name'];

/** The reference's card deposit address (kade-mvp.dc.html 844). */
const DEPOSIT_ADDRESS = '0x5Af1c4E9a7B2dD0341fE88b6C0937aA5d2e1c09D';

type Source = 'vault' | 'deposit';

export interface CardTopUpModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function CardTopUpModal({ open, onClose }: CardTopUpModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [amount, setAmount] = useState('2000');
  const [source, setSource] = useState<Source>('vault');
  const [chain, setChain] = useState<DepositChain>('Ethereum');

  useEffect(() => {
    if (!open) return;
    // Remember the trigger, move focus into the dialog, and restore the trigger
    // when the dialog closes. A browser focuses the clicked button, so the
    // active element at open time is the control that opened the dialog.
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.focus();
    return () => returnFocusRef.current?.focus();
  }, [open]);

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

  if (!open) return null;

  // XCG is derived at the fixed 1.79 peg, exactly as the reference computes it.
  const xcg = Math.round(Number(amount || 0) * 1.79).toLocaleString('en-US');
  const confirmations =
    chain === 'Ethereum' ? '3 confirmations' : '~10 seconds';
  const bridgeNote =
    chain === 'Ethereum'
      ? 'Received directly on Ethereum — our settlement network.'
      : `Received on ${chain} · bridged to Ethereum for card settlement · ~2 min, no extra fee.`;

  return (
    <div onClick={onClose} style={backdrop}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={card}
      >
        <div style={header}>
          <div>
            <div style={eyebrow}>Top up card</div>
            <div id={titleId} style={title}>
              Onchain Island Card · 4821
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
          <label style={label} htmlFor="card-topup-amount">
            Amount (USDC)
          </label>
          <input
            id="card-topup-amount"
            value={amount}
            onChange={(event) =>
              setAmount(event.target.value.replace(/[^0-9]/g, ''))
            }
            inputMode="numeric"
            style={amountInput}
          />
          <div style={pegLine}>≈ XCG {xcg} spendable at the 1.79 peg</div>

          <div style={{ ...label, margin: '16px 0 8px' }}>Source</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <SourceButton
              selected={source === 'vault'}
              onClick={() => setSource('vault')}
              name="Vault balance"
              right="USDC available"
              note="Instant · one Safe transaction · stays above your tier"
            />
            <SourceButton
              selected={source === 'deposit'}
              onClick={() => setSource('deposit')}
              name="Deposit from another source"
              right="external"
              note="Send USDC on Ethereum, Base or Arbitrum to your card address"
            />
          </div>

          {source === 'deposit' ? (
            <div style={panel}>
              <div style={eyebrow}>Network</div>
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  marginTop: '8px',
                  flexWrap: 'wrap',
                }}
              >
                {DEPOSIT_CHAINS.map((option) => (
                  <ChainChip
                    key={option.name}
                    chain={option}
                    selected={chain === option.name}
                    onClick={() => setChain(option.name)}
                    dotSize={8}
                  />
                ))}
              </div>
              <div style={{ ...eyebrow, marginTop: '14px' }}>
                Your card deposit address · {chain}
              </div>
              <div style={address}>{DEPOSIT_ADDRESS}</div>
              <div style={note}>
                USDC on {chain} · same address on all three networks · credited
                after {confirmations}
              </div>
              <div style={{ ...note, marginTop: '6px', lineHeight: 1.6 }}>
                {bridgeNote}
              </div>
            </div>
          ) : (
            <div style={vaultPanel}>
              <div style={panelRow}>
                <span style={{ color: tokens.muted }}>From</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  Safe 0x5Af1…c09D · vault USDC
                </span>
              </div>
              <div style={{ ...panelRow, alignItems: 'center' }}>
                <span style={{ color: tokens.muted }}>Vault chain</span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {DEPOSIT_CHAINS.map((option) => (
                    <ChainChip
                      key={option.name}
                      chain={option}
                      selected={chain === option.name}
                      onClick={() => setChain(option.name)}
                      dotSize={7}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <Button
            onClick={onClose}
            style={{
              marginTop: '18px',
              width: '100%',
              height: '44px',
              fontSize: '14.5px',
            }}
          >
            {source === 'vault'
              ? 'Move to card balance'
              : 'I have sent the funds'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SourceButton({
  selected,
  onClick,
  name,
  right,
  note,
}: {
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly name: string;
  readonly right: string;
  readonly note: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: '#fff',
        border: `1.5px solid ${selected ? tokens.action : tokens.border}`,
        borderRadius: '12px',
        padding: '13px 15px',
        fontFamily: 'inherit',
        cursor: 'pointer',
        color: tokens.ink,
        width: '100%',
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}
      >
        <span style={{ fontSize: '14px', fontWeight: 600 }}>{name}</span>
        <span
          style={{
            fontSize: '12.5px',
            color: tokens.muted,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {right}
        </span>
      </div>
      <div style={{ fontSize: '12px', color: tokens.muted, marginTop: '3px' }}>
        {note}
      </div>
    </button>
  );
}

function ChainChip({
  chain,
  selected,
  onClick,
  dotSize,
}: {
  readonly chain: { readonly name: string; readonly color: string };
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly dotSize: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 11px',
        border: `1.5px solid ${selected ? tokens.action : tokens.border}`,
        borderRadius: '999px',
        background: '#fff',
        fontFamily: 'inherit',
        fontSize: '12px',
        fontWeight: 600,
        cursor: 'pointer',
        color: tokens.ink,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: `${dotSize}px`,
          height: `${dotSize}px`,
          borderRadius: '2px',
          background: chain.color,
        }}
      />
      {chain.name}
    </button>
  );
}

const backdrop = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(16,24,40,.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px',
  zIndex: 60,
} as const;

const card = {
  background: '#fff',
  borderRadius: '18px',
  width: '100%',
  maxWidth: '440px',
  maxHeight: '86vh',
  overflow: 'auto',
  boxShadow: '0 30px 80px -20px rgba(16,24,40,.45)',
  animation: 'fadeUp .16s ease-out',
  outline: 'none',
} as const;

const header = {
  padding: '18px 22px',
  borderBottom: `1px solid ${tokens.border}`,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '12px',
} as const;

const eyebrow = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
} as const;

const title = {
  fontSize: '15px',
  fontWeight: 700,
  marginTop: '4px',
} as const;

const closeButton = {
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
} as const;

const label = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: tokens.muted,
  marginBottom: '6px',
} as const;

const amountInput = {
  width: '100%',
  height: '48px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '12px',
  padding: '0 14px',
  fontSize: '20px',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
  background: '#fff',
  color: tokens.ink,
  outline: 'none',
} as const;

const pegLine = {
  fontSize: '12.5px',
  color: tokens.muted,
  marginTop: '6px',
  fontVariantNumeric: 'tabular-nums',
} as const;

const panel = {
  marginTop: '14px',
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
  borderRadius: '12px',
  padding: '14px 16px',
} as const;

const vaultPanel = {
  ...panel,
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  fontSize: '13px',
} as const;

const panelRow = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
} as const;

const address = {
  fontSize: '12.5px',
  color: tokens.ink,
  marginTop: '8px',
  fontVariantNumeric: 'tabular-nums',
  wordBreak: 'break-all',
} as const;

const note = {
  fontSize: '11.5px',
  color: tokens.muted,
  marginTop: '8px',
} as const;
