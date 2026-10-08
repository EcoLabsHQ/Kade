import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * The Vote screen presents exactly the proposals the viewer can vote on.
 *
 * A proposal is available only when the viewer can effectively vote on it: it is
 * open, the category is allowed, the wallet is connected and the voting power is
 * known and strictly greater than zero. Everything else stays reachable in a
 * clearly separated, non-actionable group carrying the eligibility derivation's
 * honest reason — and the default selection never lands on a non-votable
 * proposal when a votable one exists.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/vote',
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { VoteScreen } from '@/components/vote/VoteScreen';
import type { SnapshotAdapter } from '@/lib/vote/adapter';
import { CITIZEN_SPACE_ID, RESIDENT_SPACE_ID } from '@/lib/vote/spaces';
import type { VoteProposal, VotingPowerRead } from '@/lib/vote/types';

const WALLET = '0x1111111111111111111111111111111111111111';

function proposal(overrides: Partial<VoteProposal> & Pick<VoteProposal, 'proposalId' | 'title'>): VoteProposal {
  return {
    spaceId: RESIDENT_SPACE_ID,
    category: 'resident',
    state: 'open',
    snapshotBlock: 100,
    type: 'basic',
    choices: [{ id: '0', label: 'For' }],
    provenance: 'mock',
    ...overrides,
  };
}

const known = (power: bigint): VotingPowerRead => ({
  status: 'known',
  power,
  blockNumber: 100,
  provenance: 'mock',
});

/** An adapter that serves the fixtures and the power read keyed by proposal id. */
function adapterFor(
  proposals: readonly VoteProposal[],
  powers: Readonly<Record<string, VotingPowerRead>>,
): SnapshotAdapter {
  return {
    mocked: true,
    async getSpace(spaceId) {
      return {
        id: spaceId,
        name: spaceId,
        category: spaceId === CITIZEN_SPACE_ID ? 'citizen' : 'resident',
        created: true,
      };
    },
    async listProposals(spaceId) {
      return proposals.filter((candidate) => candidate.spaceId === spaceId);
    },
    async readVotingPower({ proposalId }) {
      return powers[proposalId] ?? { status: 'unknown', reason: 'not configured' };
    },
  };
}

describe('VoteScreen available set', () => {
  it('defaults to the votable proposal, not an unavailable first one', async () => {
    // The Citizen proposal loads first but a Resident cannot vote it.
    const citizen = proposal({
      spaceId: CITIZEN_SPACE_ID,
      category: 'citizen',
      proposalId: 'p-citizen',
      title: 'Citizen assembly consultation',
    });
    const resident = proposal({
      proposalId: 'p-resident',
      title: 'Resident consultation',
    });

    render(
      <VoteScreen
        wallet={WALLET}
        membership="resident"
        adapter={adapterFor([citizen, resident], {
          'p-citizen': known(1n),
          'p-resident': known(1n),
        })}
        spaceIds={[CITIZEN_SPACE_ID, RESIDENT_SPACE_ID]}
      />,
    );

    await screen.findByTestId('vote-proposal-list');

    // The card defaults to the proposal the viewer can vote.
    expect(
      screen.getByRole('heading', { name: 'Resident consultation' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Citizen assembly consultation' }),
    ).toBeNull();

    // The votable proposal is in the available group; the Citizen proposal is
    // reachable but non-actionable, with the exact refusal text.
    const availableGroup = screen.getByTestId('vote-proposal-list');
    expect(availableGroup).toContainElement(
      screen.getByTestId('vote-proposal-p-resident'),
    );
    const unavailableGroup = screen.getByTestId('vote-proposal-list-unavailable');
    const citizenEntry = screen.getByTestId('vote-proposal-p-citizen');
    expect(unavailableGroup).toContainElement(citizenEntry);
    expect(citizenEntry).toBeDisabled();
    expect(citizenEntry).toHaveAttribute('data-available', 'false');
    expect(citizenEntry).toHaveTextContent('Colosseum Citizens only');
    cleanup();
  });

  it('does not present a closed proposal as available', async () => {
    const closed = proposal({
      proposalId: 'p-closed',
      title: 'Closed consultation',
      state: 'closed',
    });
    const open = proposal({ proposalId: 'p-open', title: 'Open consultation' });

    render(
      <VoteScreen
        wallet={WALLET}
        membership="resident"
        adapter={adapterFor([closed, open], {
          'p-closed': known(1n),
          'p-open': known(1n),
        })}
        spaceIds={[RESIDENT_SPACE_ID]}
      />,
    );

    await screen.findByTestId('vote-proposal-list');

    expect(
      screen.getByRole('heading', { name: 'Open consultation' }),
    ).toBeInTheDocument();
    const closedEntry = screen.getByTestId('vote-proposal-p-closed');
    expect(screen.getByTestId('vote-proposal-list-unavailable')).toContainElement(
      closedEntry,
    );
    expect(closedEntry).toBeDisabled();
    expect(closedEntry).toHaveTextContent('This proposal is closed.');
    cleanup();
  });

  it('does not present a proposal as available on a failed power read', async () => {
    const failed = proposal({ proposalId: 'p-failed', title: 'Unreadable power' });
    const open = proposal({ proposalId: 'p-open', title: 'Readable power' });

    render(
      <VoteScreen
        wallet={WALLET}
        membership="resident"
        adapter={adapterFor([failed, open], {
          'p-failed': { status: 'error', reason: 'RPC unavailable' },
          'p-open': known(1n),
        })}
        spaceIds={[RESIDENT_SPACE_ID]}
      />,
    );

    await screen.findByTestId('vote-proposal-list');

    // The failed read is never available; the readable proposal is selected.
    expect(
      screen.getByRole('heading', { name: 'Readable power' }),
    ).toBeInTheDocument();
    const failedEntry = screen.getByTestId('vote-proposal-p-failed');
    expect(screen.getByTestId('vote-proposal-list-unavailable')).toContainElement(
      failedEntry,
    );
    expect(failedEntry).toBeDisabled();
    expect(failedEntry).toHaveAttribute('data-available', 'false');
    expect(failedEntry).toHaveTextContent(/eligibility is not assumed/i);
    cleanup();
  });

  it('does not present a zero-power proposal as available', async () => {
    const zero = proposal({ proposalId: 'p-zero', title: 'No power' });
    const open = proposal({ proposalId: 'p-open', title: 'Has power' });

    render(
      <VoteScreen
        wallet={WALLET}
        membership="resident"
        adapter={adapterFor([zero, open], {
          'p-zero': known(0n),
          'p-open': known(1n),
        })}
        spaceIds={[RESIDENT_SPACE_ID]}
      />,
    );

    await screen.findByTestId('vote-proposal-list');

    expect(
      screen.getByRole('heading', { name: 'Has power' }),
    ).toBeInTheDocument();
    const zeroEntry = screen.getByTestId('vote-proposal-p-zero');
    expect(zeroEntry).toBeDisabled();
    expect(zeroEntry).toHaveAttribute('data-available', 'false');
    expect(zeroEntry).toHaveTextContent('You hold no voting power for this proposal.');
    cleanup();
  });
});
