'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { tokens } from '@/components/ui/tokens';

/**
 * The Vote screen (D20 / VOTE-1) — a presentational divergence declared in
 * `docs/week-3-frozen-delivery-contract.md`.
 *
 * This screen creates no capability: it has no server action, no Supabase read,
 * no Snapshot/wallet/chain code and no network call. Every figure and label
 * below is reproduced from the design handoff (`kade-mvp.dc.html`, the "Vote"
 * section) and describes a consultation the programme has not run. The ballot is
 * local UI state only — casting increments the demo tally in memory and never
 * sends anything, so "Vote recorded on Snapshot ✓" is the reference's own demo
 * copy, not a claim about a real Snapshot space.
 *
 * The declared divergence lives in the Week 3 contract, not on screen: as with
 * the Finance mocks and Week 2 amendment v1.5, the reference is reproduced
 * verbatim with no demo banner or demo-labelled control.
 */

interface Choice {
  readonly label: string;
  /** The reference's seeded demo tally for this choice. */
  readonly count: number;
}

/** The reference's three choices and their seeded demo tallies. */
const CHOICES: readonly Choice[] = [
  { label: 'Housing supply — co-finance 120 affordable units', count: 56 },
  { label: 'SME credit — first-loss capital for local lenders', count: 38 },
  { label: 'Split 50 / 50', count: 12 },
];

/** The reference's demo turnout denominator. */
const ELIGIBLE_RESIDENTS = 148;

const EYEBROW: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const NOTE_BEFORE =
  'Off-chain signature, no gas. Eligibility checked against your KYC attestation — one resident, one vote.';
const NOTE_AFTER =
  'Signed EIP-712 message · stored on IPFS · verifiable at snapshot.org/#/onchainisland.eth';

export function VoteScreen() {
  const [counts, setCounts] = useState<readonly number[]>(() =>
    CHOICES.map((choice) => choice.count),
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [voted, setVoted] = useState(false);

  // The demo tally's percentages are derived from the counts every render, so a
  // cast recomputes all three at once (and the total turnout) rather than
  // mutating a stored percentage.
  const total = counts.reduce((sum, count) => sum + count, 0);
  const percent = (index: number) =>
    Math.round(((counts[index] ?? 0) / total) * 100);

  const chosenLabel =
    selected === null ? 'Select an option' : (CHOICES[selected]?.label ?? 'Select an option');
  const castable = selected !== null && !voted;

  // The reference's `if (!s.voted)` guard: once cast, further selection is a
  // no-op and the ballot is frozen.
  function pick(index: number) {
    if (voted) return;
    setSelected(index);
  }

  function castVote() {
    if (voted || selected === null) return;
    setCounts((prev) =>
      prev.map((count, index) => (index === selected ? count + 1 : count)),
    );
    setVoted(true);
  }

  return (
    <>
      <div style={{ marginBottom: '24px' }}>
        <h1
          style={{
            margin: 0,
            fontSize: '36px',
            lineHeight: 1.1,
            fontWeight: 700,
            letterSpacing: '-.02em',
          }}
        >
          Vote
        </h1>
        <p
          style={{
            margin: '10px 0 0',
            color: tokens.muted,
            maxWidth: '62ch',
            textWrap: 'pretty',
          }}
        >
          Resident consultations run on Snapshot. One KYC-attested resident, one
          vote, no gas.
        </p>
      </div>

      <Card padding="24px 26px" radius={14}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '16px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={EYEBROW}>Resident voice · Snapshot</div>
            <h2
              style={{
                margin: '8px 0 4px',
                fontSize: '22px',
                fontWeight: 700,
                letterSpacing: '-.01em',
              }}
            >
              Programme consultation
            </h2>
            <div style={{ fontSize: '13.5px', color: tokens.muted }}>
              Space{' '}
              <span style={{ color: tokens.ink, fontWeight: 600 }}>
                onchainisland.eth
              </span>{' '}
              · one vote per KYC-attested resident · gasless signature
            </div>
          </div>
          <Chip
            tone="success"
            dot
            style={{ fontWeight: 600, padding: '5px 10px' }}
          >
            Open · closes 30 Sep
          </Chip>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.3fr 1fr',
            gap: '24px',
            marginTop: '20px',
            alignItems: 'start',
          }}
        >
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600 }}>
              Should the Local Innovation Fund allocation for 2027 prioritise
              housing supply or SME credit?
            </div>
            <div
              style={{
                fontSize: '13px',
                color: tokens.muted,
                marginTop: '6px',
                textWrap: 'pretty',
              }}
            >
              Proposed by the Ministry of Economic Development. 15% of programme
              fee revenue (≈ $2.1M) is earmarked; residents&apos; vote is advisory
              and published with the budget.
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginTop: '16px',
              }}
            >
              {CHOICES.map((choice, index) => {
                const isSelected = selected === index;
                return (
                  <button
                    key={choice.label}
                    type="button"
                    onClick={() => pick(index)}
                    aria-pressed={isSelected}
                    style={{
                      textAlign: 'left',
                      background: '#fff',
                      border: `1.5px solid ${isSelected ? tokens.action : tokens.border}`,
                      borderRadius: '12px',
                      padding: '12px 14px',
                      fontFamily: 'inherit',
                      cursor: voted ? 'default' : 'pointer',
                      color: tokens.ink,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '12px',
                      }}
                    >
                      <span style={{ fontSize: '14px', fontWeight: 600 }}>
                        {choice.label}
                      </span>
                      <span
                        style={{
                          fontSize: '12.5px',
                          color: tokens.muted,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {percent(index)}%
                      </span>
                    </div>
                    <div
                      style={{
                        position: 'relative',
                        height: '6px',
                        borderRadius: '999px',
                        background: tokens.border,
                        marginTop: '8px',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          bottom: 0,
                          borderRadius: '999px',
                          background: isSelected
                            ? tokens.action
                            : tokens.brandPrimary,
                          width: `${percent(index)}%`,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <Card padding="18px 20px" radius={12} background="#fff">
            <div style={EYEBROW}>Your ballot</div>
            <div
              style={{ fontSize: '15px', fontWeight: 600, marginTop: '8px' }}
              data-testid="vote-ballot-choice"
            >
              {chosenLabel}
            </div>
            <div
              style={{
                fontSize: '12.5px',
                color: tokens.muted,
                marginTop: '4px',
              }}
            >
              Voting power 1 · strategy{' '}
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                eas-attestation(kade.kyc.v1)
              </span>
            </div>
            <Button
              variant={castable ? 'primary' : 'locked'}
              fullWidth
              disabled={!castable}
              onClick={castVote}
              style={{
                marginTop: '16px',
                height: '42px',
                fontSize: '14px',
                ...(voted ? { background: tokens.success } : null),
              }}
            >
              {voted ? 'Vote recorded on Snapshot ✓' : 'Sign & cast vote'}
            </Button>
            <div
              style={{
                marginTop: '12px',
                fontSize: '12px',
                color: tokens.muted,
                lineHeight: 1.6,
              }}
            >
              {voted ? NOTE_AFTER : NOTE_BEFORE}
            </div>
            <div
              style={{
                height: '1px',
                background: tokens.border,
                margin: '14px 0 10px',
              }}
            />
            <div
              style={{ fontSize: '12px', color: tokens.muted }}
              data-testid="vote-turnout"
            >
              Turnout{' '}
              <strong style={{ color: tokens.ink }}>{total}</strong> votes of{' '}
              {ELIGIBLE_RESIDENTS} eligible residents
            </div>
          </Card>
        </div>
      </Card>
    </>
  );
}
