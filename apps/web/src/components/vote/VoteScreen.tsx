'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { tokens } from '@/components/ui/tokens';
import type { SnapshotAdapter } from '@/lib/vote/adapter';
import {
  CITIZEN_ONLY_REFUSAL,
  evaluateVoteEligibility,
  type VoteViewerMembership,
} from '@/lib/vote/eligibility';
import { RESIDENT_SPACE_ID } from '@/lib/vote/spaces';
import type { VoteProposal, VotingPowerRead } from '@/lib/vote/types';

/**
 * The Vote screen.
 *
 * The reference layout and copy are unchanged (VOTE-1, declared in
 * `docs/week-3-frozen-delivery-contract.md`), and the eligibility decision is
 * **real code** (`@/lib/vote/eligibility`). The Snapshot source is now the real
 * adapter (`@/lib/vote/adapter`): the page resolves the proposals and voting
 * power on the server and passes them here. An injected `adapter` is still
 * accepted (the tests use it, and the mock stays available), but production
 * renders the server-resolved data.
 *
 * When more than one proposal is loaded, a proposal list is shown. A proposal
 * the viewer cannot vote — a Citizens-only proposal for a Resident — is greyed
 * in that list with the exact text "Colosseum Citizens only" and cannot be
 * selected. Citizens vote in everything; a Resident votes the Residents space.
 *
 * The ballot itself is still local demo state: casting increments an in-memory
 * tally and never sends anything. The UI's eligibility block is a **companion to
 * the real rule, never the protection** — the contract and the Snapshot strategy
 * are what actually stop an ineligible vote. This component only reflects the
 * decision.
 *
 * States that must exist, and do: disconnected wallet, loading, read error, and
 * closed proposal. On a read error, eligibility is **not** assumed.
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
  'Signed EIP-712 message · stored on IPFS · verifiable at snapshot.org/#/kadeglobal.eth';

export interface VoteScreenProps {
  /**
   * The wallet whose voting power is read. The page passes the resident's Safe
   * address; `null` means no wallet is connected and the screen says so.
   */
  readonly wallet?: string | null;
  /** The viewer's membership, used by the citizen-only rule. */
  readonly membership?: VoteViewerMembership;
  /**
   * An injected Snapshot source. When present the screen loads through it; when
   * absent it renders the server-resolved `proposals`/`powers`.
   */
  readonly adapter?: SnapshotAdapter;
  /** The spaces to load through the adapter, in order. */
  readonly spaceIds?: readonly string[];
  /** Server-resolved proposals (the production path). */
  readonly proposals?: readonly VoteProposal[];
  /** Server-resolved voting-power reads, keyed by proposal id. */
  readonly powers?: Readonly<Record<string, VotingPowerRead>>;
  /** A server-side load failure, or null. */
  readonly error?: string | null;
}

export function VoteScreen({
  wallet = null,
  membership = 'none',
  adapter,
  spaceIds,
  proposals: preloadedProposals,
  powers: preloadedPowers,
  error: preloadedError = null,
}: VoteScreenProps) {
  const [counts, setCounts] = useState<readonly number[]>(() =>
    CHOICES.map((choice) => choice.count),
  );
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [voted, setVoted] = useState(false);
  const [proposals, setProposals] = useState<readonly VoteProposal[]>([]);
  const [powers, setPowers] = useState<Readonly<Record<string, VotingPowerRead>>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load the proposals and voting power. With an injected adapter they are read
  // through it; otherwise the server-resolved props are used directly. A failed
  // read is recorded as an error, never silently treated as "no power".
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setProposals([]);
    setPowers({});
    setSelectedId(null);

    if (adapter === undefined) {
      const loaded = preloadedProposals ?? [];
      setProposals(loaded);
      setPowers(preloadedPowers ?? {});
      setSelectedId(loaded[0]?.proposalId ?? null);
      setLoadError(preloadedError);
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const ids = spaceIds ?? [RESIDENT_SPACE_ID];
        const loaded: VoteProposal[] = [];
        for (const id of ids) {
          const space = await adapter.getSpace(id);
          if (space === null) {
            throw new Error(`The configured space "${id}" is missing.`);
          }
          loaded.push(...(await adapter.listProposals(space.id)));
        }
        if (cancelled) return;
        setProposals(loaded);
        setSelectedId(loaded[0]?.proposalId ?? null);
        if (wallet === null) return;
        const reads: Record<string, VotingPowerRead> = {};
        for (const proposal of loaded) {
          reads[proposal.proposalId] = await adapter.readVotingPower({
            spaceId: proposal.spaceId,
            proposalId: proposal.proposalId,
            wallet,
            blockNumber: proposal.snapshotBlock,
          });
        }
        if (!cancelled) setPowers(reads);
      } catch (cause) {
        if (!cancelled) {
          setLoadError(
            cause instanceof Error ? cause.message : 'The Snapshot read failed.',
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adapter, wallet, spaceIds, preloadedProposals, preloadedPowers, preloadedError]);

  const selected =
    proposals.find((proposal) => proposal.proposalId === selectedId) ??
    proposals[0] ??
    null;
  const selectedPower =
    selected === null ? null : (powers[selected.proposalId] ?? null);

  const eligibility = evaluateVoteEligibility({
    wallet,
    membership,
    proposal: selected,
    power: selectedPower,
  });

  // A read that threw is an error state; otherwise the eligibility derivation
  // already covers loading, disconnected, closed, citizen-only and no-power.
  const blockedByError = loadError !== null;

  // The demo tally's percentages are derived from the counts every render, so a
  // cast recomputes all three at once (and the total turnout) rather than
  // mutating a stored percentage.
  const total = counts.reduce((sum, count) => sum + count, 0);
  const percent = (index: number) =>
    Math.round(((counts[index] ?? 0) / total) * 100);

  const chosenLabel =
    selectedChoice === null
      ? 'Select an option'
      : (CHOICES[selectedChoice]?.label ?? 'Select an option');
  const castable = eligibility.eligible && selectedChoice !== null && !voted;

  // The reference's `if (!s.voted)` guard: once cast, further selection is a
  // no-op and the ballot is frozen.
  function pick(index: number) {
    if (voted || !eligibility.eligible) return;
    setSelectedChoice(index);
  }

  function castVote() {
    if (voted || selectedChoice === null || !eligibility.eligible) return;
    setCounts((prev) =>
      prev.map((count, index) => (index === selectedChoice ? count + 1 : count)),
    );
    setVoted(true);
  }

  function selectProposal(proposalId: string) {
    if (proposalId === selectedId) return;
    setSelectedId(proposalId);
    setSelectedChoice(null);
    setVoted(false);
  }

  const eligibilityMessage = blockedByError
    ? 'The consultation could not be read, so eligibility is not assumed.'
    : eligibility.message;

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

      {proposals.length > 1 ? (
        <Card padding="16px 18px" radius={12} style={{ marginBottom: '16px' }}>
          <div style={EYEBROW}>Proposals · {proposals.length}</div>
          <div
            data-testid="vote-proposal-list"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              marginTop: '10px',
            }}
          >
            {proposals.map((candidate) => {
              const entry = evaluateVoteEligibility({
                wallet,
                membership,
                proposal: candidate,
                power: powers[candidate.proposalId] ?? null,
              });
              const refused = entry.reason === 'citizen-only';
              const isSelected = candidate.proposalId === selected?.proposalId;
              return (
                <button
                  key={candidate.proposalId}
                  type="button"
                  data-testid={`vote-proposal-${candidate.proposalId}`}
                  data-refused={refused ? 'true' : 'false'}
                  aria-pressed={isSelected}
                  disabled={refused}
                  onClick={() => selectProposal(candidate.proposalId)}
                  style={{
                    textAlign: 'left',
                    background: '#fff',
                    border: `1.5px solid ${isSelected ? tokens.action : tokens.border}`,
                    borderRadius: '10px',
                    padding: '10px 12px',
                    fontFamily: 'inherit',
                    cursor: refused ? 'not-allowed' : 'pointer',
                    opacity: refused ? 0.55 : 1,
                    color: refused ? tokens.muted : tokens.ink,
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>
                    {candidate.title}
                  </div>
                  <div style={{ fontSize: '12px', color: tokens.muted, marginTop: '2px' }}>
                    {candidate.spaceId}
                    {candidate.state === 'closed' ? ' · Closed' : ''}
                  </div>
                  {refused ? (
                    <div
                      data-testid={`vote-proposal-refusal-${candidate.proposalId}`}
                      style={{
                        fontSize: '12.5px',
                        color: tokens.muted,
                        marginTop: '6px',
                      }}
                    >
                      {CITIZEN_ONLY_REFUSAL}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}

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
              {selected?.title ?? 'Programme consultation'}
            </h2>
            <div style={{ fontSize: '13.5px', color: tokens.muted }}>
              Space{' '}
              <span style={{ color: tokens.ink, fontWeight: 600 }}>
                {selected?.spaceId ?? RESIDENT_SPACE_ID}
              </span>{' '}
              · one vote per KYC-attested resident · gasless signature
            </div>
          </div>
          <Chip
            tone={selected?.state === 'closed' ? 'neutral' : 'success'}
            dot
            style={{ fontWeight: 600, padding: '5px 10px' }}
          >
            {selected?.state === 'closed' ? 'Closed' : 'Open · closes 30 Sep'}
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
                const isSelected = selectedChoice === index;
                const disabled = !eligibility.eligible;
                return (
                  <button
                    key={choice.label}
                    type="button"
                    onClick={() => pick(index)}
                    aria-pressed={isSelected}
                    disabled={disabled}
                    data-testid={`vote-choice-${index}`}
                    style={{
                      textAlign: 'left',
                      background: '#fff',
                      border: `1.5px solid ${isSelected ? tokens.action : tokens.border}`,
                      borderRadius: '12px',
                      padding: '12px 14px',
                      fontFamily: 'inherit',
                      cursor: disabled ? 'not-allowed' : voted ? 'default' : 'pointer',
                      color: disabled ? tokens.muted : tokens.ink,
                      opacity: disabled ? 0.55 : 1,
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
                erc721(Colosseum)
              </span>
            </div>

            {/* The eligibility decision, rendered honestly: a refusal is shown
                as text, and the vote button stays disabled. This block is a
                companion to the real rule, never the protection. */}
            {eligibilityMessage !== null ? (
              <div
                data-testid="vote-eligibility"
                data-reason={blockedByError ? 'error' : eligibility.reason}
                style={{
                  marginTop: '10px',
                  fontSize: '12.5px',
                  color: tokens.muted,
                  lineHeight: 1.5,
                }}
              >
                {eligibilityMessage}
              </div>
            ) : null}

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
