import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * The Vote screen's proposal list.
 *
 * When the real page loads both spaces, the screen shows every proposal. A
 * Citizens-only proposal is greyed for a Resident with the exact text
 * "Colosseum Citizens only" and cannot be selected; a Citizen can select both.
 * The source is injected, so these tests never dial the network.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/vote',
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { VoteScreen } from '@/components/vote/VoteScreen';
import type { SnapshotAdapter } from '@/lib/vote/adapter';
import { CITIZEN_SPACE_ID, RESIDENT_SPACE_ID } from '@/lib/vote/spaces';
import type { VoteProposal } from '@/lib/vote/types';

const WALLET = '0x1111111111111111111111111111111111111111';

const RESIDENT: VoteProposal = {
  spaceId: RESIDENT_SPACE_ID,
  proposalId: 'p-resident',
  title: 'Resident: Add February 2nd to official holiday',
  category: 'resident',
  state: 'open',
  snapshotBlock: 100,
  type: 'basic',
  choices: [{ id: '0', label: 'For' }],
  provenance: 'snapshot',
};

const CITIZEN: VoteProposal = {
  ...RESIDENT,
  spaceId: CITIZEN_SPACE_ID,
  proposalId: 'p-citizen',
  category: 'citizen',
  title: 'Citizen: Add February 2nd to official holiday',
};

/** An adapter that answers both spaces from the fixture proposals. */
const twoSpaces: SnapshotAdapter = {
  mocked: false,
  async getSpace(spaceId) {
    return {
      id: spaceId,
      name: spaceId,
      category: spaceId === CITIZEN_SPACE_ID ? 'citizen' : 'resident',
      created: true,
    };
  },
  async listProposals(spaceId) {
    return [RESIDENT, CITIZEN].filter((proposal) => proposal.spaceId === spaceId);
  },
  async readVotingPower({ blockNumber }) {
    return { status: 'known', power: 1n, blockNumber, provenance: 'snapshot' };
  },
};

describe('VoteScreen proposal list', () => {
  it('greys the Citizens proposal for a Resident with the exact text', async () => {
    render(
      <VoteScreen
        wallet={WALLET}
        membership="resident"
        adapter={twoSpaces}
        spaceIds={[RESIDENT_SPACE_ID, CITIZEN_SPACE_ID]}
      />,
    );

    await screen.findByTestId('vote-proposal-list');

    const residentEntry = screen.getByTestId('vote-proposal-p-resident');
    expect(residentEntry).toBeEnabled();
    expect(residentEntry).toHaveAttribute('data-refused', 'false');

    const citizenEntry = screen.getByTestId('vote-proposal-p-citizen');
    expect(citizenEntry).toBeDisabled();
    expect(citizenEntry).toHaveAttribute('data-refused', 'true');
    expect(citizenEntry).toHaveTextContent('Colosseum Citizens only');

    // The Residents proposal is selected first and is the card's proposal.
    expect(
      screen.getByRole('heading', {
        name: 'Resident: Add February 2nd to official holiday',
      }),
    ).toBeInTheDocument();
    cleanup();
  });

  it('lets a Citizen select either proposal', async () => {
    render(
      <VoteScreen
        wallet={WALLET}
        membership="citizen"
        adapter={twoSpaces}
        spaceIds={[RESIDENT_SPACE_ID, CITIZEN_SPACE_ID]}
      />,
    );

    await screen.findByTestId('vote-proposal-list');
    expect(screen.getByTestId('vote-proposal-p-resident')).toBeEnabled();
    const citizenEntry = screen.getByTestId('vote-proposal-p-citizen');
    expect(citizenEntry).toBeEnabled();
    expect(citizenEntry).toHaveAttribute('data-refused', 'false');
    cleanup();
  });

  it('renders a single proposal without a list', async () => {
    const single: SnapshotAdapter = {
      ...twoSpaces,
      async listProposals(spaceId) {
        return spaceId === RESIDENT_SPACE_ID ? [RESIDENT] : [];
      },
    };
    render(<VoteScreen wallet={WALLET} membership="resident" adapter={single} />);

    await screen.findByRole('heading', {
      name: 'Resident: Add February 2nd to official holiday',
    });
    expect(screen.queryByTestId('vote-proposal-list')).toBeNull();
    cleanup();
  });
});
